import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import CafeteriaCard from '../components/CafeteriaCard.js';

const HomePage = () => {
  const [cafeterias, setCafeterias] = useState([]);
  const location = useLocation();

  useEffect(() => {
    fetch('http://localhost:4000/api/cafeterias')
      .then(res => res.json())
      .then(setCafeterias);
  }, []);
  return (
    <div>
      {location.state?.orderPlaced && (
        <p className='auth-error' style={{ background: '#f0fdf4', color: '#16a34a', borderColor: '#bbf7d0' }}>
          Order #{location.state.orderId} placed successfully!
        </p>
      )}
      <section className='hero'>
        <h1 className='hero-title'>STC Delivered to Your Doorstep</h1>
        <p className='hero-subtitle'>Order directly from your favorite SU cafeterias</p>
      </section>
      <section>
        <h2 className='section-title'>University Cafeterias:</h2>
        <div className='cafeteria-grid'>
          {cafeterias.map((cafeteria) => (
            <CafeteriaCard key={cafeteria.id} cafeteria={cafeteria} />
          ))}
        </div>
      </section>
    </div>
  );
};

export default HomePage;
