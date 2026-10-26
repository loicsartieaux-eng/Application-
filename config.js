// Connexion à la base Airtable « NumLo Followers ».
// Ces identifiants ne sont pas secrets : sans la clé (token), ils ne donnent accès à rien.
const AIRTABLE = {
  baseId: 'appS4iGPGQ97swyxf',
  comptes: {
    table: 'tblSO7UPWa2ydOS8Q',
    name: 'fldy9Qc1ufpbXVzJu',
    network: 'fldOJwX4meSo2kgQ5',
    color: 'fldFUPnasPBinuRfM',
  },
  releves: {
    table: 'tblsQiwBQCOxb2XnA',
    label: 'fldbtCXTFhZgkSXGp',
    date: 'fldRsHsQVleMkx6V5',
    count: 'fldht9iUTRj1fTA0w',
    page: 'fldOR0WFCEHxGuphN',
  },
};

// Clé Airtable chiffrée avec ton mot de passe (code de connexion généré par
// l'application). Une fois rempli, chaque appareil ne demande plus que le mot de passe.
const CODE_CONNEXION = '6dXKQkBX0CA3sgoGCz7pog==.seySN5wxeK5bLy7W.jV6qOkKW358akfhPKN5hmKzRIC9zkFNKDE0XdQVlqiNdU3dhCFvMr50LMdvcYZH4N6lf6du6DLVwja7GVMIz/qpXmrD/t98YoQ8oqenC5EDDnruDJmO3otIzFHKD5Br5BfU=';
