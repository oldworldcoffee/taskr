import { Component } from 'react';

export default class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Route crashed:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">This page hit a display error.</p>
          <p className="mt-1">{this.state.error.message || 'Unknown error'}</p>
        </div>
      );
    }

    return this.props.children;
  }
}
