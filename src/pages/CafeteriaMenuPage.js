import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import MenuItem from '../components/MenuItem.js';

const CafeteriaMenuPage = () => {
  const { id } = useParams();
  const [cafeteria, setCafeteria] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`http://localhost:4000/api/cafeterias/${id}`)
      .then((res) => res.json())
      .then((data) => {
        setCafeteria(data);
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return <div className='load-state'>Loading...</div>
  }

  if (!cafeteria || !cafeteria.id) {
    return (
      <div>
        <h2 className='error-text'>Cafeteria not Found</h2>
        <Link to="/" className='back-link'>Back to Home</Link>
      </div>
    );
  }
  return (
    <div>
      <Link to="/" className='back-link'>Back to all Cafeterias</Link>
      <div className='menu-header'>
        <h1 className='menu-header-title'>{cafeteria.name}</h1>
        <div className='menu-header-info'>
          <span>⭐ {cafeteria.rating}</span>
          <span>🕐 {cafeteria.delivery_time}</span>
        </div>
        <p className='menu-header-desc'>{cafeteria.description}</p>
      </div>

      <div className='menu-list'>
        {cafeteria.menu.map((item) => (
          <MenuItem key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
};

export default CafeteriaMenuPage;
