import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext.js';
import { useAuth } from '../context/AuthContext.js';
import { useLive } from '../context/LiveContext.js';
import { API_URL, formatKES } from '../api.js';

const CheckoutPage = () => {
  const { cart, cafeteriaId, removeFromCart, updateQuantity, getTotal, clearCart } = useCart();
  const { token } = useAuth();
  const { wallet, refresh } = useLive();
  const navigate = useNavigate();

  const total = getTotal();
  const remaining = wallet?.status === 'ok' ? wallet.remaining : null; // food budget left on Pesa Tracker
  const shortBy = remaining != null ? Math.max(0, total - remaining) : 0;

  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');

  const handlePlaceOrder = async () => {
    setError('');
    setPlacing(true);

    try {
      const res = await fetch(`${API_URL}/api/orders`, {
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

      // The live stream normally updates the wallet already; this guarantees it even if the stream is down.
      refresh();
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
            <h3>Total: KES {total}</h3>
          </div>

          {remaining != null && (
            <dl className='checkout-wallet' aria-live='polite'>
              <div>
                <dt>Food budget remaining</dt>
                <dd>{formatKES(remaining)}</dd>
              </div>
              <div>
                <dt>This order</dt>
                <dd>−{formatKES(total)}</dd>
              </div>
              <div className='checkout-wallet-after'>
                <dt>After this order</dt>
                <dd>{shortBy > 0 ? 'Over budget' : formatKES(remaining - total)}</dd>
              </div>
            </dl>
          )}
          {shortBy > 0 && (
            <p className='checkout-short'>
              This order is {formatKES(shortBy)} more than your remaining food budget, so it can't be placed. Remove something from your cart to continue.
            </p>
          )}
          {wallet?.status === 'unavailable' && (
            <p className='checkout-short'>
              Pesa Tracker is not reachable right now, so your food budget can't be checked and orders can't be placed until it is back.
            </p>
          )}

          <div className='checkout-actions'>
            <button className='btn btn--secondary' onClick={clearCart} disabled={placing}>Clear Cart</button>
            <button className='btn btn--primary btn--lg' onClick={handlePlaceOrder} disabled={placing || shortBy > 0}>
              {placing ? 'Placing Order...' : 'Place Order'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default CheckoutPage;