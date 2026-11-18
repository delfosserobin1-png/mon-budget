// Mon Budget — le « service worker » : le petit programme qui permet à l'appli installée de
// s'ouvrir sans connexion et de se mettre à jour toute seule.
//
// Principe :
//  - à l'installation, TOUS les fichiers de l'appli (liste ci-dessous) sont téléchargés, vérifiés
//    un par un (empreinte SHA-256) puis rangés dans une réserve propre à cette version ;
//  - ensuite l'appli est toujours servie depuis cette réserve : elle démarre sans réseau, et ne
//    mélange jamais les fichiers de deux versions ;
//  - quand une nouvelle version est publiée, elle est préparée à côté sans rien interrompre, puis
//    prend le relais au lancement suivant (ou quand on touche « Mettre à jour » dans l'appli).
//
// Ce programme ne touche jamais aux données (opérations, enveloppes…) : elles sont dans la base
// locale du téléphone, pas dans cette réserve. Les échanges avec d'autres sites (la boîte à
// commentaires) ne passent pas par lui.
//
// La liste ci-dessous est écrite par « npm run pwa » (tools/pwa.mjs) : ne pas la modifier à la main.

/* GENERE:DEBUT */
const VERSION = "2.2.0";
const BUILD = "15fd4d93b68cbad4";
const FILES = [
  ["css/app.css", "185364ad45ccda488ff218788c7685aeeb4e2cc57f5999974e5b3d8eb4fa3758"],
  ["exemples/releve-exemple.pdf", "5db699a0d7e129d9f6d247333a25785b5992058f6e42658261bff5100c332703"],
  ["fonts/inter-400.woff", "899122c9fc86169f81f1f58527d477616c5447dc9a32149949ac5bbe4ef5733b"],
  ["fonts/inter-500.woff", "f3bd59cccdd335310bddfc07e29677d8f11135b1cb4d0545c755e8d283853d09"],
  ["fonts/inter-600.woff", "a72f34d157db5f2ce1cc0d9df851a7d87a9dd667f46118fed853f752fe829050"],
  ["fonts/inter-display-600.woff", "bd0e9a6c3206c50082596d35bc8c4af93ffcfb5b2e4b2279fda9be7fe24e9f8f"],
  ["icons/apple-touch-icon.png", "c6e5f4045d27471638c3c9ecb37030f14d954a3860d130b9537e0c6a64c0595c"],
  ["icons/icon-192.png", "45adc4fdd71c0be2f72657352264afb3aeb294fcc5eafa529a51e930e208ab4f"],
  ["icons/icon-512.png", "eaa320449de39d556cc52970115599e9527199e53d6130069477b853dec4efb8"],
  ["icons/icon.svg", "15f1d6273bdeacbadc55aa611348d9946c6841d0316feabd2d51ee5f381df78e"],
  ["icons/maskable-192.png", "2459a7c064a8b4e89582cf9d697089310204ce78e06713a775099ec85ee2f3b3"],
  ["icons/maskable-512.png", "38913abc3ade22ff831476aca3b9d93d78c524de8e514430398c575397750b2a"],
  ["index.html", "ab4db952f85636bb2a63db1860c1b6cb18c422bbbcab001ec629b65fa62497f4"],
  ["js/changelog.js", "ec21e0a50ccd5f8e61f6a7d9c7be68dd516531651857e5b80ceb61cc81cde1d2"],
  ["js/config.js", "5933275032d4b5aa939981002126caded3e2f094886a72ad3a14bde389fdf41b"],
  ["js/core/balances.js", "fe67a237060af1c95c15649b8437d014b52e3b36c2dae7f830ae4ce65d7dc235"],
  ["js/core/changeset.js", "d97207efbe86e0801c209c2cd1f49718ea78cfd7e0e5b3a3a46644f228136302"],
  ["js/core/comments.js", "e1c975b89873a0847846ef0573841a57e1548ffe1c516f66aba1faed2337f856"],
  ["js/core/dates.js", "6e0e72c5b7a5d117e7b3e2f95c54cbd1b609e76116a3e51c08f90110b2c108ce"],
  ["js/core/demo.js", "4824f07f21520319a92f226c388866ed36b79d97d782cdccaa29092fbf121361"],
  ["js/core/envelopes.js", "b8d3285003abe4915e60f8b532375d6524df6a36d32cc9ccde80bb9503304b94"],
  ["js/core/filters.js", "964d5f10ea08721be9e6cc09c97e3a6b6c2d3641c07be6b7df3e80555c2e3a1a"],
  ["js/core/ids.js", "8a0a558dbe089df95bb2a22d326cbc2310c88410338e8ad1f8aba198477af4c6"],
  ["js/core/matching.js", "db5b79a44db11cb06e660227676b10b7d81bcd3ac9116ffb0334f0048d7ec401"],
  ["js/core/money.js", "a2c058972e71c1f78116ac50d357f674786062761f3f8af3dd9d674a1aca7bd3"],
  ["js/core/operations.js", "a7ed2dd177e47c524c105154948f0d93298bdab00ca923951e79a6fdd7c49a88"],
  ["js/core/portable.js", "397864c982017f39b1d5fadbb98587ae66a01e32bf9af6713d5da2f3d490bb60"],
  ["js/core/quotas.js", "8e9e709edd578ecc777a43ac5d1e26d0bc6dbf0fefcb65eb601a2fcef8169641"],
  ["js/core/reconciliation.js", "79ed96ed363f71a83b3ce57c022cbb455c9c8020a4a62f9d267772a9e3a473ef"],
  ["js/core/recurring.js", "6a06e5b490cca661a5880e5f297ba216e2d7a0da1ab9cc15d83b5ad3ed65b539"],
  ["js/core/rules.js", "d1d3f2a2737cafe2755823deda56c8cafdfd3bbcfe2be027f7a643af44e3f2d7"],
  ["js/core/schema.js", "06d3ce7260b24ce8c97df5033ada0ae147bfe0224d8f0f3556280b1eb5d812a8"],
  ["js/core/sha256.js", "efbe06354307c044816f76e9835d9eaf002d02ca1ee3fe54a3cb6896b863f21f"],
  ["js/core/stats.js", "139022ce3cbbbb6e2f44ab94cf3870613d38ecee0d3c45c78cb06bda7b41164c"],
  ["js/core/tags.js", "72198a38ffccd543830277c9bed5c9a58e2c14f793f7dafdf4128988c50c4809"],
  ["js/core/text.js", "3d15eb05c10ba12106e461afb4d31c8a40e40712eb356cbc6c594bd32121c48b"],
  ["js/data/backup.js", "0e1fb1d8e7dd18601587656a3e99b930344182232966480c5241afd63f4fdb49"],
  ["js/data/claude-link.js", "6624d1487b503cc64845e9af5e894dbf323f3ac9e7f22683c10e98b3b8503465"],
  ["js/data/db.js", "1ebfee1674a5a40b7c2c2840c01f2969d7ec51524d6782d52c0015a4bf5c5e99"],
  ["js/data/store.js", "dbcf0afdd91aa11c91d433f01849a37aa9d3428103138dffa17e55b468451915"],
  ["js/io/exports.js", "082b464596b2a82d974dfc4c28ba677117b2bd59bd569b453b4117c524c11124"],
  ["js/io/github.js", "91311194eb8cf709cedd70e297a513b861b357311249b95d75075eeae8378e95"],
  ["js/io/statement/index.js", "01b611909f11153a3ccd6aa6ce58e1c18f5ade0b68b542bad503cdb194dcbac9"],
  ["js/io/statement/labels.js", "8c96240b9754cbae99da8c939e37b5dab913d1698b3a581d9c1fb7870bceb917"],
  ["js/io/statement/pdf-table.js", "b1f41c7b182ef1c1961451e006a74815abdb4f67883c44d4b1d1e5aa58200cce"],
  ["js/io/statement/pdf.js", "3f438912a9454e6851ec62bb8f502b68c16a14b11e68df065d6fc44478826f4a"],
  ["js/io/statement/text-formats.js", "04e884d46efceae203a7da62b1ebcb0bef20d2f17858160aea3e6763e4598bbf"],
  ["js/io/xlsx.js", "a1575c532b82a0b3caf69ada40385325cab78ff5649241476b57d42935afc0a1"],
  ["js/io/zip.js", "8bb77ee6865c4e27a5405401e1fdc8fb722c444193800016e404c1da00048368"],
  ["js/main.js", "19d99c04d55deac52eff583dc448ca4d660def981a8f05e7ac1e9d31535b0ee6"],
  ["js/platform/folder.js", "da4f616d959f536790d0b05848662eb784ab075ea00678695a1887d7f9d09aee"],
  ["js/platform/platform.js", "18713bd504b74603df98f17519e92a7bb16e9336084ecf10e3832ca76e298ac1"],
  ["js/platform/pwa.js", "3e55cb5a34bcdeaeee01f3540471779d7333ae5004ea18b6e5accdbdee77df88"],
  ["js/ui/annotate.js", "48a50b79f62ff801aa50c8e7be26adf50f04fbb1a3e925dc5356837228a280ba"],
  ["js/ui/app.js", "541a8e21053c07c6969e1079cef93f6663deb89123a06dda4aa2d226ec941db3"],
  ["js/ui/capture.js", "b421735b13df7ac4b38eb18b83be622c197ffa0a60201435ee0db9fb576b18b2"],
  ["js/ui/charts/charts.js", "d610421957287bcff815f70f5337499fa8accac1dc26b664d52315d5a6dccbd4"],
  ["js/ui/dom.js", "3bbefba4b0195d10d7c3227fd0c5f45370cb4a41a577bf32bffb9404e3b8f4ef"],
  ["js/ui/fields.js", "0274cf36dc99d2664ec37401e9ce339ce0fe84c4b6bddaf1fca6e373279210b3"],
  ["js/ui/forms/envelope.js", "57a471f2e2bcbf59da8f8b616fc5ed557492bdf4eb16f5e7702a55377c1617b5"],
  ["js/ui/forms/filters.js", "bd286aa2c5a537e09c1a1a49abe45c137694471b4a090f15f1d71c952ac2f8a0"],
  ["js/ui/forms/operation.js", "e699090d6d27525d2eda57e526af574e727b5f2e69f760ed596f041c97ec43c7"],
  ["js/ui/forms/recurring.js", "4b6cb334261ebfd3333bbe39518caa941570f260f828f686d631bd687814d720"],
  ["js/ui/forms/tag.js", "bd204c29fdf305e0f0f347f467effe912a499fec7fd7a77d18993ee21d8eb52e"],
  ["js/ui/icons.js", "3997a15371d4f913133d5860f59c8c89e89645798a75b6102d6ff947d7aba7c5"],
  ["js/ui/oprow.js", "0c5eca99ed8041825c7d5405f10e31a9ec7ec3b42bb63488c3fdda27ce6b0737"],
  ["js/ui/overlays.js", "e194b76fc6cac71357f5eb1e40eb1ade0627051309293399b28015029e80995f"],
  ["js/ui/photos.js", "7a653630d71ba0cd8b9c37e9c2b0190bc740145c0966438349b9f75dae9e67cb"],
  ["js/ui/pwa-ui.js", "414ff7acf9d76e5217342f29eb09b3cf4323a8d7d1fdb86a5ec357ecad9a6550"],
  ["js/ui/quotas-ui.js", "ee5a414e7e2447991410785f856bfbddc28229b6d30405c548029950819d031f"],
  ["js/ui/screens/bugs.js", "bf11e351263794d15340687d210866276fb1f4953fa6f4a7edb3f545fe9cbca4"],
  ["js/ui/screens/claude.js", "903afc0fe7d91ee767a1ce6c9f1b9987e7d7df1c4615a0d66059b53a40bd5239"],
  ["js/ui/screens/data-screens.js", "580995395e69973cc4400d4222adb80357f672b8200a3aa8dce2149087c614bd"],
  ["js/ui/screens/envelope.js", "a333e625bffc14fd9a97fe601c5a724ccfa80d08a587bc2b1a1aa05be62bcc98"],
  ["js/ui/screens/envelopes.js", "ea4962e0ab77190d14423c97db7057e73339f4c0ffb0debbdc766500742b4712"],
  ["js/ui/screens/forecast.js", "316b17d67ef6161d03c954ef56dc7e57a8e491d08e65e9a9c10b6c7ff444fc77"],
  ["js/ui/screens/guide.js", "41064dae5f743768570161674679c00d85fb6abb99f5de5bd2667ffb1870fd3a"],
  ["js/ui/screens/lock.js", "a6ba1e9ad84754f4912fc0e84c2f9413be8aef9ae55900bcabb7e7d8a8dd01ed"],
  ["js/ui/screens/more.js", "e5bba7982c2d1ff0b8bb2ab0248efd0da6728e468425c5c40fed9062334b7cfb"],
  ["js/ui/screens/onboarding.js", "01f476db70dcc9b84bf7ba96f87cc8042d2df3e9bd5ba0dc899bd59bf8389470"],
  ["js/ui/screens/operations.js", "27cb20e5195eccce0236f2a61662b0f0a8e8186234bfebc5ce48c379aa5ec3fb"],
  ["js/ui/screens/settings-screens.js", "cd89a753b46eb670de168ffacd922a459600f5cb9ddfd083828673fb138f9155"],
  ["js/ui/screens/statement.js", "2db67fbccf55c4920e87a7871a9909e8b9eeda2c01463631657d57e3499be262"],
  ["js/ui/screens/stats.js", "c2b72a459918b7ac32955e1a45def9d093ff44cbfbd9f0455c3edaf89513d997"],
  ["js/ui/screens/sub-screens.js", "bf4d9d2b7f7f33b2165bdbb6b412059f1ea859e1d8b72451a2a90a0c6fb2ef3e"],
  ["js/ui/shell.js", "4d317880685864ec0df9744f4238c2ac04dcbc4fc3abe7c23714be5af01d259c"],
  ["manifest.webmanifest", "7d5126bee0c4cf0dd1ad11a02a53f9fe97a0cd600938d4aaf13b44106daae8b3"],
  ["vendor/pdfjs/pdf.min.js", "9fab0c910bf1484835c5c2aeb68f7eb3dfce7f9eb435a004526c5af86d70890c"],
  ["vendor/pdfjs/pdf.worker.min.js", "bc0d1b88ea0b66196b1d36a58ac243c6d92adfe725624e2a9fdd381bdf8ef434"],
];
/* GENERE:FIN */

const CACHE_PREFIX = 'mon-budget-';
const CACHE = `${CACHE_PREFIX}${BUILD}`;
const BASE = new URL('./', self.location).href; // le dossier de l'appli (se termine par « / »)
const INDEX = new URL('index.html', BASE).href;
const PARALLEL = 6;

const hex = (buffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** Télécharge un fichier sans passer par le cache du navigateur et vérifie son empreinte. */
async function fetchVerified(path, expected) {
  const url = new URL(path, BASE).href;
  const response = await fetch(url, { cache: 'reload', credentials: 'same-origin' });
  if (!response.ok) throw new Error(`${path} : réponse ${response.status}`);
  const body = await response.arrayBuffer();
  const digest = hex(await crypto.subtle.digest('SHA-256', body));
  if (digest !== expected) throw new Error(`${path} : contenu différent de la version publiée`);
  const headers = new Headers();
  const type = response.headers.get('Content-Type');
  if (type) headers.set('Content-Type', type);
  return { url, response: new Response(body, { status: 200, headers }) };
}

async function install() {
  const cache = await caches.open(CACHE);
  let next = 0;
  const worker = async () => {
    while (next < FILES.length) {
      const [path, hash] = FILES[next++];
      const { url, response } = await fetchVerified(path, hash);
      await cache.put(url, response);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, FILES.length) }, worker));
}

async function tellClients(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const client of clients) client.postMessage(message);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    install().catch(async (error) => {
      // Une réserve incomplète ne doit jamais servir : on l'efface, la version en place continue.
      await caches.delete(CACHE);
      await tellClients({ type: 'INSTALL_ERROR', build: BUILD, message: String((error && error.message) || error) });
      throw error;
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

async function serve(request) {
  const url = new URL(request.url);
  url.search = '';
  url.hash = '';
  const key = url.href === BASE ? INDEX : url.href;
  const cache = await caches.open(CACHE);
  const hit = await cache.match(key);
  if (hit) return hit;
  // Une adresse inconnue ouverte comme une page (ancien raccourci, lien tronqué) : on sert l'appli.
  if (request.mode === 'navigate') {
    const shell = await cache.match(INDEX);
    if (shell) return shell;
  }
  return fetch(request);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith(BASE)) return; // autre site, ou autre dossier du même site : on ne s'en mêle pas
  event.respondWith(serve(request));
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  else if (type === 'GET_VERSION' && event.ports && event.ports[0]) event.ports[0].postMessage({ version: VERSION, build: BUILD, files: FILES.length });
});
