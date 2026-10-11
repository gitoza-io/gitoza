//! Parse JUnit XML into normalized test-case rows.

use quick_xml::events::Event;
use quick_xml::Reader;

const MAX_FAILURE_BODY_BYTES: usize = 32 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedTestCase {
    pub classname: Option<String>,
    pub name: String,
    pub suite_name: Option<String>,
    pub result: String,
    pub duration_sec: Option<f64>,
    pub failure_message: Option<String>,
    pub failure_body: Option<String>,
    pub system_out: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedJUnitStats {
    pub total: i64,
    pub passed: i64,
    pub failed: i64,
    pub skipped: i64,
    pub error: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedJUnitFile {
    pub cases: Vec<ParsedTestCase>,
    pub stats: ParsedJUnitStats,
}

pub fn parse_junit_xml(xml: &[u8]) -> Result<ParsedJUnitFile, String> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);
    let mut cases = Vec::new();
    let mut stack: Vec<Frame> = Vec::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(e)) => {
                let name = local_name_bytes(e.name().as_ref());
                match name.as_str() {
                    "testcase" => {
                        if let Some(case_row) = testcase_from_start_attrs(&e, &stack) {
                            cases.push(case_row);
                        }
                    }
                    "skipped" => {
                        if let Some(Frame::Case(fields)) = stack.last_mut() {
                            fields.result = "skipped".to_string();
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Start(e)) => {
                let name = local_name(&e);
                match name.as_str() {
                    "testsuite" | "testsuites" => {
                        stack.push(Frame::Suite {
                            name: attr_value(&e, b"name"),
                        });
                    }
                    "testcase" => {
                        let mut fields = testcase_fields_from_start(&e);
                        fields.suite_name = innermost_suite_name(&stack);
                        stack.push(Frame::Case(fields));
                    }
                    "failure" | "error" => {
                        if let Some(Frame::Case(fields)) = stack.last_mut() {
                            fields.result = if name == "error" {
                                "error".to_string()
                            } else {
                                "failed".to_string()
                            };
                            fields.failure_message = attr_value(&e, b"message");
                        }
                        stack.push(Frame::TextCapture {
                            target: if name == "error" {
                                TextTarget::ErrorBody
                            } else {
                                TextTarget::FailureBody
                            },
                        });
                    }
                    "skipped" => {
                        if let Some(Frame::Case(fields)) = stack.last_mut() {
                            fields.result = "skipped".to_string();
                        }
                    }
                    "system-out" => {
                        stack.push(Frame::TextCapture {
                            target: TextTarget::SystemOut,
                        });
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(e)) => {
                let text = String::from_utf8_lossy(e.as_ref()).trim().to_string();
                if text.is_empty() {
                    continue;
                }
                capture_text(&mut stack, &text);
            }
            Ok(Event::CData(e)) => {
                let text = String::from_utf8_lossy(e.as_ref()).trim().to_string();
                if text.is_empty() {
                    continue;
                }
                capture_text(&mut stack, &text);
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().local_name().as_ref()).into_owned();
                match name.as_str() {
                    "testcase" => {
                        if let Some(Frame::Case(fields)) = stack.pop() {
                            cases.push(fields.into_parsed());
                        }
                    }
                    "failure" | "error" | "system-out" => {
                        if matches!(stack.last(), Some(Frame::TextCapture { .. })) {
                            stack.pop();
                        }
                    }
                    "testsuite" | "testsuites" => {
                        if matches!(stack.last(), Some(Frame::Suite { .. })) {
                            stack.pop();
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("JUnit XML parse error: {e}")),
            _ => {}
        }
        buf.clear();
    }

    let stats = compute_stats(&cases);
    Ok(ParsedJUnitFile { cases, stats })
}

fn compute_stats(cases: &[ParsedTestCase]) -> ParsedJUnitStats {
    let mut stats = ParsedJUnitStats::default();
    stats.total = cases.len() as i64;
    for c in cases {
        match c.result.as_str() {
            "passed" => stats.passed += 1,
            "failed" => stats.failed += 1,
            "skipped" => stats.skipped += 1,
            "error" => stats.error += 1,
            _ => stats.passed += 1,
        }
    }
    stats
}

pub fn merge_junit_stats(files: &[ParsedJUnitStats]) -> ParsedJUnitStats {
    let mut out = ParsedJUnitStats::default();
    for s in files {
        out.total += s.total;
        out.passed += s.passed;
        out.failed += s.failed;
        out.skipped += s.skipped;
        out.error += s.error;
    }
    out
}

pub fn execution_status_from_stats(stats: &ParsedJUnitStats) -> String {
    let bad = stats.failed + stats.error;
    if bad == 0 {
        "passed".to_string()
    } else if stats.passed > 0 {
        "partial".to_string()
    } else {
        "failed".to_string()
    }
}

fn truncate_body(s: String) -> String {
    if s.len() <= MAX_FAILURE_BODY_BYTES {
        return s;
    }
    let mut end = MAX_FAILURE_BODY_BYTES;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &s[..end])
}

fn capture_text(stack: &mut Vec<Frame>, text: &str) {
    if let Some(Frame::TextCapture { target }) = stack.last() {
        match target {
            TextTarget::FailureBody | TextTarget::ErrorBody => {
                if let Some(Frame::Case(fields)) =
                    stack.iter_mut().rev().find(|f| matches!(f, Frame::Case(_)))
                {
                    let existing = fields.failure_body.take().unwrap_or_default();
                    let merged = if existing.is_empty() {
                        text.to_string()
                    } else {
                        format!("{existing}\n{text}")
                    };
                    fields.failure_body = Some(truncate_body(merged));
                }
            }
            TextTarget::SystemOut => {
                if let Some(Frame::Case(fields)) =
                    stack.iter_mut().rev().find(|f| matches!(f, Frame::Case(_)))
                {
                    fields.system_out = Some(truncate_body(text.to_string()));
                }
            }
        }
    }
}

#[derive(Debug)]
struct CaseFields {
    classname: Option<String>,
    name: String,
    suite_name: Option<String>,
    duration_sec: Option<f64>,
    result: String,
    failure_message: Option<String>,
    failure_body: Option<String>,
    system_out: Option<String>,
}

impl CaseFields {
    fn into_parsed(self) -> ParsedTestCase {
        ParsedTestCase {
            classname: self.classname,
            name: self.name,
            suite_name: self.suite_name,
            result: self.result,
            duration_sec: self.duration_sec,
            failure_message: self.failure_message,
            failure_body: self.failure_body,
            system_out: self.system_out,
        }
    }
}

fn testcase_fields_from_start(e: &quick_xml::events::BytesStart<'_>) -> CaseFields {
    CaseFields {
        classname: attr_value(e, b"classname"),
        name: attr_value(e, b"name").unwrap_or_else(|| "unnamed".to_string()),
        suite_name: None,
        duration_sec: attr_value(e, b"time").and_then(|s| s.parse().ok()),
        result: "passed".to_string(),
        failure_message: None,
        failure_body: None,
        system_out: None,
    }
}

fn testcase_from_start_attrs(
    e: &quick_xml::events::BytesStart<'_>,
    stack: &[Frame],
) -> Option<ParsedTestCase> {
    let mut fields = testcase_fields_from_start(e);
    fields.suite_name = innermost_suite_name(stack);
    Some(fields.into_parsed())
}

/// Innermost non-empty `testsuite` / `testsuites` name on the ancestor stack.
fn innermost_suite_name(stack: &[Frame]) -> Option<String> {
    for frame in stack.iter().rev() {
        if let Frame::Suite { name } = frame {
            if let Some(n) = name.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                return Some(n.to_string());
            }
        }
    }
    None
}

fn local_name_bytes(name: &[u8]) -> String {
    String::from_utf8_lossy(name).into_owned()
}

fn local_name(e: &quick_xml::events::BytesStart<'_>) -> String {
    String::from_utf8_lossy(e.name().local_name().as_ref()).into_owned()
}

fn attr_value(e: &quick_xml::events::BytesStart<'_>, key: &[u8]) -> Option<String> {
    for attr in e.attributes().flatten() {
        if attr.key.local_name().as_ref() == key {
            return Some(String::from_utf8_lossy(&attr.value).into_owned());
        }
    }
    None
}

#[derive(Debug)]
enum TextTarget {
    FailureBody,
    ErrorBody,
    SystemOut,
}

#[derive(Debug)]
enum Frame {
    Suite { name: Option<String> },
    Case(CaseFields),
    TextCapture { target: TextTarget },
}

#[cfg(test)]
mod tests {
    use super::*;

    const SIMPLE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Example" tests="3" failures="1" skipped="1">
  <testcase classname="com.example.A" name="testPass" time="0.12"/>
  <testcase classname="com.example.A" name="testFail" time="0.05">
    <failure message="assertion failed">expected true got false</failure>
  </testcase>
  <testcase classname="com.example.B" name="testSkip">
    <skipped/>
  </testcase>
</testsuite>"#;

    #[test]
    fn parses_pass_fail_skip() {
        let parsed = parse_junit_xml(SIMPLE.as_bytes()).unwrap();
        assert_eq!(parsed.stats.total, 3);
        assert_eq!(parsed.stats.passed, 1);
        assert_eq!(parsed.stats.failed, 1);
        assert_eq!(parsed.stats.skipped, 1);
        assert_eq!(parsed.cases[0].suite_name.as_deref(), Some("Example"));
        assert_eq!(parsed.cases[1].result, "failed");
        assert_eq!(
            parsed.cases[1].failure_message.as_deref(),
            Some("assertion failed")
        );
    }

    #[test]
    fn parses_nested_suites() {
        let xml = r#"<?xml version="1.0"?>
<testsuites>
  <testsuite name="outer">
    <testcase classname="c" name="one"/>
    <testsuite name="inner">
      <testcase classname="c" name="two">
        <error message="boom">stack</error>
      </testcase>
    </testsuite>
  </testsuite>
</testsuites>"#;
        let parsed = parse_junit_xml(xml.as_bytes()).unwrap();
        assert_eq!(parsed.cases.len(), 2);
        assert_eq!(parsed.cases[0].suite_name.as_deref(), Some("outer"));
        assert_eq!(parsed.cases[1].suite_name.as_deref(), Some("inner"));
        assert_eq!(parsed.cases[1].result, "error");
    }

    #[test]
    fn parses_sibling_suites_like_nightly_ui() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="NightlyUiRun" tests="2" failures="0" skipped="0" errors="0" time="1.0">
  <testsuite name="LoginSuite" tests="1" failures="0" skipped="0" errors="0" time="0.5">
    <testcase classname="com.gitoza.ui.auth.LoginPageTest" name="testShowsLoginForm" time="0.5"/>
  </testsuite>
  <testsuite name="DashboardSuite" tests="1" failures="0" skipped="0" errors="0" time="0.5">
    <testcase classname="com.gitoza.ui.dashboard.DashboardTest" name="testLoadsSummaryCards" time="0.5"/>
  </testsuite>
</testsuites>"#;
        let parsed = parse_junit_xml(xml.as_bytes()).unwrap();
        assert_eq!(parsed.cases.len(), 2);
        assert_eq!(parsed.cases[0].suite_name.as_deref(), Some("LoginSuite"));
        assert_eq!(
            parsed.cases[1].suite_name.as_deref(),
            Some("DashboardSuite")
        );
    }
}
