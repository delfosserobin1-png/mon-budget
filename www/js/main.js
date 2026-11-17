// Point d'entrée : lance l'appli, et affiche un écran de secours si le démarrage échoue.
import { boot, showBootFailure } from './ui/app.js';

const mount = document.getElementById('app');
boot(mount).catch((error) => {
  console.error(error);
  showBootFailure(mount, error);
});
