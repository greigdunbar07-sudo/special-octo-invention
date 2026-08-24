import './main.css';

const rootElement = document.getElementById('root');

function renderStartupError(reason: unknown) {
  if (!rootElement) return;
  const message = reason instanceof Error ? reason.message : String(reason);
  rootElement.replaceChildren();
  const screen = document.createElement('main');
  screen.className = 'startup-error';
  const card = document.createElement('section');
  const marker = document.createElement('div');
  marker.className = 'startup-error-mark';
  const heading = document.createElement('h1');
  heading.textContent = 'The portal could not start';
  const body = document.createElement('p');
  body.textContent = message || 'An unexpected startup error occurred.';
  const help = document.createElement('small');
  help.textContent = 'Refresh the page. If the problem continues, send this message to the portal administrator.';
  card.append(marker, heading, body, help);
  screen.append(card);
  rootElement.append(screen);
}

window.addEventListener('error', (event) => renderStartupError(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => renderStartupError(event.reason));

if (!rootElement) {
  throw new Error('The portal root element is missing.');
}

void import('@/bootstrapApp')
  .then(({ mountPortal }) => mountPortal(rootElement))
  .catch(renderStartupError);
