import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import ErrorMessage from '../components/ErrorMessage';

export default function AuthPage({ mode }) {
  const { user, authenticate } = useAuth();
  const location = useLocation();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const isRegister = mode === 'register';

  if (user) return <Navigate to={location.state?.from?.pathname ?? '/'} replace />;

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { name, email, password } = form;
      await authenticate(mode, isRegister ? { name, email, password } : { email, password });
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={handleSubmit}>
        <div className="brand auth-brand">
          <span className="brand-mark">⬡</span> JobMesh
        </div>
        <h1>{isRegister ? 'Create your account' : 'Sign in'}</h1>

        {isRegister && (
          <label>
            Name
            <input value={form.name} onChange={update('name')} required maxLength={100} autoFocus />
          </label>
        )}
        <label>
          Email
          <input type="email" value={form.email} onChange={update('email')} required autoFocus={!isRegister} />
        </label>
        <label>
          Password
          <input
            type="password"
            value={form.password}
            onChange={update('password')}
            required
            minLength={isRegister ? 8 : 1}
          />
        </label>

        <ErrorMessage error={error} />
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
        </button>

        <p className="muted auth-switch">
          {isRegister ? 'Already have an account? ' : 'New to JobMesh? '}
          <Link to={isRegister ? '/login' : '/register'}>{isRegister ? 'Sign in' : 'Create an account'}</Link>
        </p>
      </form>
    </div>
  );
}
