import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';

const RegisterPage = () => {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const { register } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        try{
            await register(name, email, password);
            navigate('/');
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <div className='auth-page'>
            <h1 className='auth-title'>Create Account</h1>
            {error && <p className='auth-error'>{error}</p>}
            <form onSubmit={handleSubmit} className='auth-form'>
                <input
                    type='text'
                    placeholder='Full Name'
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required             
                />
                <input 
                    type='emaail'
                    placeholder='user@example.com'
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                />
                <input
                    type='password'
                    placeholder='Password'
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}               
                />
                <button type='submit' className='btn btn--primary btn--lg'>Create Account</button>
            </form>
            <p>Already have an account? <Link to='/login'>Log In</Link></p>
        </div>
    );
};

export default RegisterPage;