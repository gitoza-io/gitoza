import AddRepoWizard from "../components/AddRepoWizard";

/**
 * First-run / onboarding: full-screen Connect Repository flow.
 * Reuses AddRepoWizard with variant="fullscreen".
 */
function ConnectRepository({ onConnected }) {
  return (
    <AddRepoWizard
      variant="fullscreen"
      onSuccess={onConnected}
    />
  );
}

export default ConnectRepository;
