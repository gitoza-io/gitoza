@echo off
setlocal

where rustc >nul 2>&1
if errorlevel 1 (
  echo Rust not found; installing stable via rustup...
  curl -sSf -o rustup-init.exe https://win.rustup.rs/x86_64
  if errorlevel 1 exit /b 1
  rustup-init.exe -y --default-toolchain stable
  if errorlevel 1 exit /b 1
  del rustup-init.exe
)

call "%USERPROFILE%\.cargo\env.bat"
echo %USERPROFILE%\.cargo\bin>>"%GITHUB_PATH%"

rustc --version
cargo --version
