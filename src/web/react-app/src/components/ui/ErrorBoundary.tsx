import { Component, type ReactNode, type ErrorInfo } from 'react';
import { Button } from './button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary bileşeni - React hata yakalama mekanizması
 * Uygulama çökmesini önler ve kullanıcıya hata bildirimi gösterir
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    // Hata loglama - production'da bir hata izleme servisine gönderilebilir
    console.error('[ErrorBoundary] Yakalanan hata:', error);
    console.error('[ErrorBoundary] Bileşen yığını:', errorInfo.componentStack);
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-screen p-8 bg-background text-foreground">
          <div className="max-w-md w-full space-y-6 text-center">
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-destructive">
                Bir şeyler yanlış gitti
              </h1>
              <p className="text-muted-foreground">
                Beklenmeyen bir hata oluştu. Lütfen sayfayı yenilemeyi deneyin.
              </p>
            </div>

            <div className="p-4 bg-muted rounded-lg text-left">
              <p className="text-sm font-mono text-muted-foreground break-all">
                {this.state.error?.message || 'Bilinmeyen hata'}
              </p>
            </div>

            <div className="flex gap-3 justify-center">
              <Button onClick={this.handleReset} variant="default">
                Tekrar Dene
              </Button>
              <Button
                onClick={() => window.location.reload()}
                variant="outline"
              >
                Sayfayı Yenile
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
