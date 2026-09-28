import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext.js';
import { useAuth } from '../context/AuthContext.js';

const CheckoutPage = () => {
  const { cart, cafeteriaId, removeFromCart, updateQuantity, getTotal, clearCart } = useCart();
  const { token } = useAuth();
  const navigate = useNavigate();

  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');

  const handlePlaceOrder = async () => {
    setError('');
    setPlacing(true);

    try {
      const res = await fetch('http://localhost:4000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          cafeteria_id: cafeteriaId,
          items: cart.map((item) => ({ menu_item_id: item.id, quantity: item.quantity }))
        })
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401) {
          navigate('/login');
          return;
        }
        throw new Error(data.error || 'Failed to place order');
      }

      clearCart();
      navigate('/', {state: { orderPlaced: true, orderId: data.id} });
    } catch (err) {
      setError(err.message);
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className='checkout'>
      <Link to="/" className='back-link2'>← Back to Cafeterias</Link>
      <h1 className='checkout-title'>Your Order:</h1>

      {cart.length === 0 ? (
        <div className='checkout-empty'>
          <div className='checkout-empty-icon'>🛒</div>
          <p className='checkout-empty-text'>Your cart is empty. Browse our cafeterias and add some meals!</p>
          <Link to="/" className='btn btn--primary btn--lg'>Browse Cafeterias</Link>
        </div>
      ) : (
        <div className="checkout-summary">
          {error && <p className='auth-error'>{error}</p>}

          <div className='checkout-items'>
            {cart.map((item) => (
              <div key={item.id} className='checkout-item'>
                <div className='checkout-item-details'>
                  <h4>{item.name}</h4>
                  <span className='checkout-item-price'>KES {item.price} × {item.quantity}</span>
                </div>
                <div className='checkout-item-qty'>
                  <button
                    className='btn btn--secondary'
                    onClick={() => updateQuantity(item.id, item.quantity - 1)}
                    disabled={item.quantity <= 1}
                  >-</button>
                  <span>{item.quantity}</span>
                  <button
                    className='btn btn--secondary'
                    onClick={() => updateQuantity(item.id, item.quantity + 1)}
                  >+</button>
                </div>
                <button className='btn btn--danger'
                  onClick={() => { removeFromCart(item.id); alert((`${item.name} is being removed from cart`)) }}
                > Remove
                </button>
              </div>
            ))}
          </div>
          <div className='checkout-total'>
            <h3>Total: KES {getTotal()}</h3>
          </div>

          <div className='checkout-actions'>
            <button className='btn btn--secondary' onClick={clearCart} disabled={placing}>Clear Cart</button>
            <button className='btn btn--primary btn--lg' onClick={handlePlaceOrder} disabled={placing}>
              {placing ? 'Placing Order...' : 'Place Order'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default CheckoutPage;