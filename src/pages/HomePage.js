import { useEffect, useState } from 'react';
import CafeteriaCard from '../components/CafeteriaCard.js';

const HomePage = () => {
  const [cafeterias, setCafeterias] = useState([]);

  useEffect(() => {
    fetch('http://localhost:4000/api/cafeterias')
      .then(res => res.json())
      .then(setCafeterias);
  }, []);
  return (
    <div>
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
