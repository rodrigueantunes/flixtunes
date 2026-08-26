import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Barrière d'erreur de l'application.
 *
 * Sans elle, la moindre exception pendant un rendu démonte tout l'arbre React et laisse un écran
 * entièrement noir : aucun message, aucune action possible, et rien à rapporter. C'est le pire
 * comportement possible — la personne ne peut ni comprendre ni contourner, et l'incident se signale
 * par « ça ne marche plus ».
 *
 * La barrière conserve l'en-tête de l'application, explique ce qui s'est passé, propose de recharger,
 * et affiche le détail technique sous un dépliant pour qu'il puisse être recopié dans un rapport.
 */
interface Props { children: ReactNode }
interface State { error: Error | null; componentStack: string | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, componentStack: info.componentStack ?? null });
    // Conservé sur l'objet global : c'est ce qui permet de récupérer la trace complète depuis la
    // console d'un navigateur, là où le message d'origine est souvent tronqué.
    (window as Window & { __flixtunesLastError?: unknown }).__flixtunesLastError = {
      message: error.message, stack: error.stack, componentStack: info.componentStack,
    };
  }

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    return <section className="app-error" role="alert">
      <h1>Cet écran n’a pas pu s’afficher</h1>
      <p>
        Une erreur inattendue est survenue. Vos données ne sont pas affectées : le problème vient de
        l’affichage. Recharger la page suffit le plus souvent à retrouver un état normal.
      </p>
      <div className="app-error-actions">
        <button className="primary" onClick={() => window.location.reload()}>Recharger</button>
        <button onClick={() => { this.setState({ error: null, componentStack: null }); }}>Réessayer sans recharger</button>
      </div>
      <details>
        <summary>Détail technique</summary>
        <pre>{error.message}{"\n"}{error.stack}{componentStack ? `\n--- composants ---${componentStack}` : ""}</pre>
      </details>
    </section>;
  }
}
