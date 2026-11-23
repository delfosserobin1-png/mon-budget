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
const VERSION = "2.3.0";
const BUILD = "585301acec9ccf09";
const FILES = [
  ["banque-retour.html", "7623cac615c829018dcd07cdb86401f3deee38775bf150602e7e3561a942c665"],
  ["css/app.css", "1317c20d9c2fa729f41cce9327dbe657da105f270df51e1be080019019578b21"],
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
  ["js/changelog.js", "b0b1c6201ab9c1bbf283ed0f375b0f99fc6e4c94170e699717f7e4f20beaf68e"],
  ["js/config.js", "5933275032d4b5aa939981002126caded3e2f094886a72ad3a14bde389fdf41b"],
  ["js/core/balances.js", "fe67a237060af1c95c15649b8437d014b52e3b36c2dae7f830ae4ce65d7dc235"],
  ["js/core/categories.js", "14c0b602b44cf15cf590fdf471b98fe3be379eca0a2ad1d129c423c4114f4b7a"],
  ["js/core/changeset.js", "d97207efbe86e0801c209c2cd1f49718ea78cfd7e0e5b3a3a46644f228136302"],
  ["js/core/chiffre.js", "9c7368ed4891c39a816d9a8d107309a2394118f059f72b661d3ac3e3c27a01c9"],
  ["js/core/comments.js", "a70809e47add8cbc684aa540e48efee7922dfadee9dcea6dbc7a1aaa0df43a51"],
  ["js/core/dashboard.js", "f8021e59dc027180e8acae9c0a41d9dc60dbc5db58c9dc60136de9e95fec1c71"],
  ["js/core/dates.js", "6e0e72c5b7a5d117e7b3e2f95c54cbd1b609e76116a3e51c08f90110b2c108ce"],
  ["js/core/demo.js", "4824f07f21520319a92f226c388866ed36b79d97d782cdccaa29092fbf121361"],
  ["js/core/envelopes.js", "b8d3285003abe4915e60f8b532375d6524df6a36d32cc9ccde80bb9503304b94"],
  ["js/core/filters.js", "c7eedd0e9f3012b8bc68b7fd018d7854154945f27cd2755c748321a7260ecfe6"],
  ["js/core/ids.js", "8a0a558dbe089df95bb2a22d326cbc2310c88410338e8ad1f8aba198477af4c6"],
  ["js/core/matching.js", "9ae62ad1ade27625e7cc4d6a505dc9c7151592ab4f320b48d0f3dcd8cc037181"],
  ["js/core/money.js", "a2c058972e71c1f78116ac50d357f674786062761f3f8af3dd9d674a1aca7bd3"],
  ["js/core/operations.js", "1cf6c0ea6f26f3162c652de3414f43121bd9ddac9160bae82338c9fa23f211ef"],
  ["js/core/portable.js", "397864c982017f39b1d5fadbb98587ae66a01e32bf9af6713d5da2f3d490bb60"],
  ["js/core/quotas.js", "bb8b06875b190c487189a7e466f69d926f6266d42380310df3121e6fb3bf2c24"],
  ["js/core/reconciliation.js", "79ed96ed363f71a83b3ce57c022cbb455c9c8020a4a62f9d267772a9e3a473ef"],
  ["js/core/recurring.js", "65f29c3e274f4c8f31b8725fcd45b2d543730217020a202ad2d9a4e559771674"],
  ["js/core/rules.js", "d1d3f2a2737cafe2755823deda56c8cafdfd3bbcfe2be027f7a643af44e3f2d7"],
  ["js/core/schema.js", "06d3ce7260b24ce8c97df5033ada0ae147bfe0224d8f0f3556280b1eb5d812a8"],
  ["js/core/sha256.js", "efbe06354307c044816f76e9835d9eaf002d02ca1ee3fe54a3cb6896b863f21f"],
  ["js/core/stats.js", "139022ce3cbbbb6e2f44ab94cf3870613d38ecee0d3c45c78cb06bda7b41164c"],
  ["js/core/tags.js", "72198a38ffccd543830277c9bed5c9a58e2c14f793f7dafdf4128988c50c4809"],
  ["js/core/text.js", "3d15eb05c10ba12106e461afb4d31c8a40e40712eb356cbc6c594bd32121c48b"],
  ["js/data/backup.js", "0e1fb1d8e7dd18601587656a3e99b930344182232966480c5241afd63f4fdb49"],
  ["js/data/claude-link.js", "50426627bd464d334e3e09b1d500ced89223cc61f304dc162de00715cd9547f6"],
  ["js/data/db.js", "1ebfee1674a5a40b7c2c2840c01f2969d7ec51524d6782d52c0015a4bf5c5e99"],
  ["js/data/store.js", "dbcf0afdd91aa11c91d433f01849a37aa9d3428103138dffa17e55b468451915"],
  ["js/io/exports.js", "9194fff40c95b6e880f8cfd981c23f618b30e6745f2925aae21d868be9e4f450"],
  ["js/io/github.js", "b33eba53a447f43f9a8742c3ce869d80a998b9141cc7ec8d0d423414adab4220"],
  ["js/io/statement/index.js", "1f219eb826cc11620824de48a0da3afdc776d29812304f96b336e24f38294c3c"],
  ["js/io/statement/labels.js", "8c96240b9754cbae99da8c939e37b5dab913d1698b3a581d9c1fb7870bceb917"],
  ["js/io/statement/pdf-table.js", "b1f41c7b182ef1c1961451e006a74815abdb4f67883c44d4b1d1e5aa58200cce"],
  ["js/io/statement/pdf.js", "3f438912a9454e6851ec62bb8f502b68c16a14b11e68df065d6fc44478826f4a"],
  ["js/io/statement/text-formats.js", "3e4509bf2f2cc7369e1ed31af66dd1ad7310807d3c46bb8f3015688ac4deb289"],
  ["js/io/xlsx.js", "a1575c532b82a0b3caf69ada40385325cab78ff5649241476b57d42935afc0a1"],
  ["js/io/zip.js", "8bb77ee6865c4e27a5405401e1fdc8fb722c444193800016e404c1da00048368"],
  ["js/main.js", "19d99c04d55deac52eff583dc448ca4d660def981a8f05e7ac1e9d31535b0ee6"],
  ["js/platform/folder.js", "da4f616d959f536790d0b05848662eb784ab075ea00678695a1887d7f9d09aee"],
  ["js/platform/platform.js", "18713bd504b74603df98f17519e92a7bb16e9336084ecf10e3832ca76e298ac1"],
  ["js/platform/pwa.js", "3e55cb5a34bcdeaeee01f3540471779d7333ae5004ea18b6e5accdbdee77df88"],
  ["js/ui/annotate.js", "48a50b79f62ff801aa50c8e7be26adf50f04fbb1a3e925dc5356837228a280ba"],
  ["js/ui/app.js", "d5e02fbcf191efd5d9cd84c95d025e1f7fba7049934824f32e21d6761b9cbab4"],
  ["js/ui/capture.js", "b421735b13df7ac4b38eb18b83be622c197ffa0a60201435ee0db9fb576b18b2"],
  ["js/ui/charts/charts.js", "788e87dc4aa516200acb860e7bd1e4ba052855e7f3279142309ac305ea0e272f"],
  ["js/ui/dashboard.js", "3b9e9d4a9143177f6b2e6c767ad598b1ea98f3d77ff27c52a0d1d60ab2f97196"],
  ["js/ui/dom.js", "3bbefba4b0195d10d7c3227fd0c5f45370cb4a41a577bf32bffb9404e3b8f4ef"],
  ["js/ui/fields.js", "0274cf36dc99d2664ec37401e9ce339ce0fe84c4b6bddaf1fca6e373279210b3"],
  ["js/ui/forms/envelope.js", "57a471f2e2bcbf59da8f8b616fc5ed557492bdf4eb16f5e7702a55377c1617b5"],
  ["js/ui/forms/filters.js", "bd286aa2c5a537e09c1a1a49abe45c137694471b4a090f15f1d71c952ac2f8a0"],
  ["js/ui/forms/operation.js", "754ac122c7909fcda0001a1eacc7cb8d88e875c6fa5540a84f4fb6e8ebea1e2c"],
  ["js/ui/forms/recurring.js", "f5f446d78ed08e3feb9b03c25ed841546e1f90c63d5320168f6f79b84f72b7a9"],
  ["js/ui/forms/tag.js", "2b129ebcf8214e92e3d9d1977b1d7906f9eb3ef76045fb1c20e9842a25ff336a"],
  ["js/ui/icons.js", "3997a15371d4f913133d5860f59c8c89e89645798a75b6102d6ff947d7aba7c5"],
  ["js/ui/oprow.js", "0c5eca99ed8041825c7d5405f10e31a9ec7ec3b42bb63488c3fdda27ce6b0737"],
  ["js/ui/overlays.js", "e194b76fc6cac71357f5eb1e40eb1ade0627051309293399b28015029e80995f"],
  ["js/ui/photos.js", "7a653630d71ba0cd8b9c37e9c2b0190bc740145c0966438349b9f75dae9e67cb"],
  ["js/ui/pwa-ui.js", "414ff7acf9d76e5217342f29eb09b3cf4323a8d7d1fdb86a5ec357ecad9a6550"],
  ["js/ui/quotas-ui.js", "ee5a414e7e2447991410785f856bfbddc28229b6d30405c548029950819d031f"],
  ["js/ui/screens/bank.js", "a46670701ef923eba32f66f95c80adb0a0858dc5d7d985f510715a8b6260c885"],
  ["js/ui/screens/bugs.js", "8f2a593610d3509d24b57fa6fa949703c49c02214700c66bc2a84dcd27f177ca"],
  ["js/ui/screens/claude.js", "903afc0fe7d91ee767a1ce6c9f1b9987e7d7df1c4615a0d66059b53a40bd5239"],
  ["js/ui/screens/data-screens.js", "2cfd0c4d011de589ec0979423fb6359548fb23064f15f369a5771ea85998cb6b"],
  ["js/ui/screens/envelope.js", "c6f0f03da4b6f90bdee888499076231ef2d69f12c921f81821efb4758bd2e0e6"],
  ["js/ui/screens/envelopes.js", "ea4962e0ab77190d14423c97db7057e73339f4c0ffb0debbdc766500742b4712"],
  ["js/ui/screens/forecast.js", "59e1e837f3ed8ef86322b5d96eb12ca51f4fb8846435afd44fa9b041c1a7c2e8"],
  ["js/ui/screens/guide.js", "4a89cb1c3ab91834cf01a5ecc18a374d53754b4bc76c6618577f9d6f8fa9fdcf"],
  ["js/ui/screens/lock.js", "a6ba1e9ad84754f4912fc0e84c2f9413be8aef9ae55900bcabb7e7d8a8dd01ed"],
  ["js/ui/screens/more.js", "2d76dd3e16c0b27837e55e4dedfb9754b7430207ca540195ee1564ad71fc0c8c"],
  ["js/ui/screens/onboarding.js", "01f476db70dcc9b84bf7ba96f87cc8042d2df3e9bd5ba0dc899bd59bf8389470"],
  ["js/ui/screens/operations.js", "a374665514f101639dbf2b925a5d70ad28636487b25103f1dce746d5fa45b9bc"],
  ["js/ui/screens/settings-screens.js", "22d7f68b3daa3e4fb89b68be10973ca0bdeb8a94493f62ce825e46e4fbaeef97"],
  ["js/ui/screens/statement.js", "493660ae0928f6dc3869d979ada0bcd2b67e52befe9b7dc848803e9a5e6c0a16"],
  ["js/ui/screens/stats.js", "e331590accc97126bdaea5f7500eb0b118bee77d4d436bc8f3edcd6ff2e31c7d"],
  ["js/ui/screens/sub-screens.js", "27f4b63396de61e50e483d142412e187cc495ecfd67a74ed7157f122fde5f14d"],
  ["js/ui/shell.js", "4d317880685864ec0df9744f4238c2ac04dcbc4fc3abe7c23714be5af01d259c"],
  ["js/ui/topups.js", "30ec3b107d6309963e2d2c9440d532f6ebc582986cac1679aaa912e1e78f96c1"],
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
