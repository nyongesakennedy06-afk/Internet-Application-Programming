import { Link } from 'react-router-dom';

const CafeteriaCard = ({ cafeteria }) => {
  return (
    <Link to={`/cafeteria/${cafeteria.id}`} className="cafeteria-card">
      <img
        src={cafeteria.image}
        alt={cafeteria.name}
        className="cafeteria-card-image"
      />

      <div className="cafeteria-card-body">
        <h3 className="cafeteria-name">{cafeteria.name}</h3>
        <p className="cafeteria-desc">{cafeteria.description}</p>

        <div className="cafeteria-card-meta">
          <span>⭐ {cafeteria.rating}</span>
          <span>🕐 {cafeteria.deliveryTime || cafeteria.delivery_time}</span>
          {cafeteria.menu && <span>📋 {cafeteria.menu.length} items</span>}
        </div>
      </div>
    </Link>
  );
};

export default CafeteriaCard;