import AppRouter from "./app/router";
import { AuthProvider } from "./context/AuthContext";
import { ReadOnlyProvider } from "./context/ReadOnlyContext";
import { LanguageProvider } from "./i18n";

function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <ReadOnlyProvider>
          <AppRouter />
        </ReadOnlyProvider>
      </AuthProvider>
    </LanguageProvider>
  );
}

export default App;
