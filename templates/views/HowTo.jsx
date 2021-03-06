const React = require('react');
const renderReact = require('hypernova-react').renderReact;

function TheComponent(props) {
  props = Object.assign({
    class: "m-how-to"
  }, props);

  return <div className={props.class}>
          <h2 className="major">How To</h2>
          <h3>HOW TO PLAY</h3>
          <p>You must discover the “mystery location” and take a picture of your bike there. Then you must bike to a new "mystery location" of your choosing and take a picture of your bike there. Submit both pictures to the <strong>TAG IT!</strong> section. NOTE: you may not "reserve" being "IT" by immediately posting a photo of your bike in the old "mystery location" before finding and posting a picture of the new "mystery location."</p>
          <h3>THE RULES</h3>
          <p>Mystery locations must be freely accessible to the public and by bicycle. Mystery locations should be unique/interesting/identifiable. Tags that include only nondescript features (blank walls) are not acceptable and will be removed. Mystery locations may not be mobile objects (food trucks, for example). Discovered mystery locations and new mystery locations must be tagged with the same bicycle, on the same ride. Pictures of discovered mystery locations and new mystery locations must be posted at the same time.</p>
        </div>;
}

module.exports = renderReact('HowTo', TheComponent);
