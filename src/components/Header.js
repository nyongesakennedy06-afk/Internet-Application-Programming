import { Link } from 'react-router-dom';
import { useContext } from 'react';
import { ThemeContext } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';

const Header = () => {
  const { darkMode, toggleTheme } = useContext(ThemeContext);
  const { user, logout } = useAuth();

  return (
    <header className="header">
      <div className="header_inner">
        <Link to="/" className="header_logo">StrathsBites</Link>
        <nav className="header_nav">
          <Link to="/" className='header_link'>Home</Link>
          <Link to="/checkout" className="header_cartbtn">🛒 Cart</Link>
          {user ? (
            <>
              <span className='header_username'>Hi, {user.name}</span>
              <button onClick={logout} className='header_link'>Log Out</button>
            </>
          ) : (
            <Link to='/login' className='header_link'>Log In</Link>
          )}
          <button
            onClick={toggleTheme}
            className="theme_btn">

            {darkMode ? "☀️ Light" : "🌙 Dark"}
          </button>
        </nav>
      </div>
    </header>
  );
};

export default Header;
