import { createContext, useContext, useState } from 'react';

const CartContext = createContext();

const CartProvider = ({ children }) => {
  const [cart, setCart] = useState([]);
  const [cafeteriaId, setCafeteriaId] = useState(null);

  const addToCart = (item) => {
    const switchingCafeteria = cart.length > 0 && cafeteriaId && item.cafeteria_id !== cafeteriaId;

    if (switchingCafeteria) {
      const confirmed = window.confirm(
        'Your cart has items from a different cafeteria. Adding this item will clear your current cart. Continue?'
      );
      if (!confirmed) return;
    }

    setCafeteriaId(item.cafeteria_id);
    setCart((prev) => {
      const base = switchingCafeteria ? [] : prev;
      const existing = base.find((i) => i.id === item.id);
      if (existing) {
        return base.map((i) => (i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...base, { ...item, quantity: 1 }];
    });
  };

  const removeFromCart = (itemId) => {
    setCart((prev) => {
      const next = prev.filter((item) => item.id !== itemId);
      if (next.length === 0) setCafeteriaId(null);
      return next;
    });
  };

  const updateQuantity = (itemId, quantity) => {
    if (quantity < 1) return;
    setCart((prev) => prev.map((item) => (item.id === itemId ? { ...item, quantity } : item)));
  };

  const getTotal = () => {
    return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  };

  const clearCart = () => {
    setCart([]);
    setCafeteriaId(null);
  };

  return (
    <CartContext.Provider
      value={{ cart, cafeteriaId, addToCart, removeFromCart, updateQuantity, getTotal, clearCart }}
    >
      {children}
    </CartContext.Provider>
  );
};

const useCart = () => useContext(CartContext);

export { CartProvider, useCart };