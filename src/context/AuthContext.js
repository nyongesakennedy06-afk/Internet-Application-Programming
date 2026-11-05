import { createContext, useContext, useState, useEffect } from 'react';
import { API_URL } from '../api.js';

const AuthContext = createContext();

const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(localStorage.getItem('token'));
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!token) {
            setLoading(false);
            return;
        }
        // Only a 401 from the server means the session is bad. A cancelled request (page reload,
        // StrictMode re-run) or the API being briefly down must NOT log the user out.
        const controller = new AbortController();
        fetch(`${API_URL}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal
        })
            .then(async (res) => {
                if (res.status === 401) {
                    localStorage.removeItem('token');
                    setToken(null);
                    setUser(null);
                    return;
                }
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                setUser(data.user);
            })
            .catch((err) => {
                if (err.name === 'AbortError') return; // superseded; the newer check will finish the job
                // Server unreachable: keep the token so the user is still logged in once it's back.
                // The login token is a JWT, so we can show their name meanwhile.
                try {
                    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
                    if (payload.exp * 1000 > Date.now()) setUser({ id: payload.id, name: payload.name, email: payload.email, role: payload.role });
                } catch { /* malformed token: leave the user logged out */ }
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [token]);

    const login = async (email, password) => {
        const res = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json'},
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Login Failed ');
        }
        localStorage.setItem('token', data.token);
        setToken(data.token);
        setUser(data.user);
    };

    const register = async (name, email, password) => {
        const res = await fetch(`${API_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password })
        });
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Registration Failed ');
        }

        localStorage.setItem('token', data.token);
        setToken(data.token);
        setUser(data.user);
    };

    const logout = () => {
        localStorage.removeItem('token');
        setToken(null);
        setUser(null);
    };

    return (
        <AuthContext.Provider value = {{ user, token, loading, login, register, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

const useAuth = () => useContext(AuthContext);

export { AuthProvider, useAuth };