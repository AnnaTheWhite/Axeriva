import AppRouter from "./app/router";
import { AuthProvider } from "./context/AuthContext";
import { LanguageProvider } from "./i18n";

function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </LanguageProvider>
  );
}

export default App;