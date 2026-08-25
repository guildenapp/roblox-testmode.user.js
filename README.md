# Roblox TEST MODE

Bac à sable **strictement local** pour roblox.com : faux solde de Robux, achats
simulés, bandeau d'avertissement permanent et panneau de réglage dans les
paramètres. Rien n'est envoyé à Roblox, aucun Robux réel n'est débité ni
crédité, et aucun achat n'aboutit côté serveur — les requêtes d'achat sont
court-circuitées avant de partir.

## Deux fichiers, deux usages

| Fichier | À quoi il sert |
| --- | --- |
| `roblox-testmode.user.js` | Le script complet. C'est lui qui fait tout le travail. |
| `loader.user.js` | Un chargeur minuscule : il télécharge et exécute le script ci-dessus depuis GitHub. |

### Installation simple (pas de mise à jour automatique)

Installe `roblox-testmode.user.js` dans ton extension de userscripts. À chaque
modification du dépôt, il faut recopier le fichier à la main.

C'est le cas des extensions qui lisent un **fichier local** (Userscripts sur
iOS/macOS, par exemple) : elles ne consultent jamais `@updateURL`, donc un
changement sur GitHub ne les atteint pas.

### Installation avec mise à jour automatique

Installe **`loader.user.js` à la place**, une seule fois. Ce fichier local ne
change plus jamais : à chaque chargement de roblox.com, il

1. exécute immédiatement la dernière version qu'il a mise en cache (pas
   d'attente réseau, indispensable pour intercepter les premiers appels de la
   page) ;
2. puis, au maximum une fois toutes les 6 h, retélécharge
   `roblox-testmode.user.js` depuis `main` et le met en cache pour le prochain
   rechargement.

Le cache vit dans le `localStorage` de roblox.com. Une réponse d'erreur de
GitHub ne l'écrase jamais : en cas de panne réseau, la dernière version connue
continue de tourner.

Pour vérifier que ça marche, ouvre la console : le chargeur y écrit
`[TEST MODE / chargeur] code exécuté depuis …`.

#### Si le chargeur ne parvient pas à exécuter le code

Le chargeur utilise `new Function(code)`, soumis à la *Content Security Policy*
de roblox.com. Si la console affiche une erreur de CSP à propos d'`eval`, cette
méthode est inutilisable sur ce site et il faut passer par la solution
suivante.

### Solution de repli : mettre à jour le fichier local lui-même

Sur iOS, l'extension Userscripts lit un dossier de l'app Fichiers (souvent dans
iCloud Drive). Une automatisation Raccourcis peut donc remplacer le fichier
sans toucher au navigateur :

1. **Raccourcis → nouveau raccourci**
2. *Obtenir le contenu de l'URL* →
   `https://raw.githubusercontent.com/guildenapp/roblox-testmode.user.js/main/roblox-testmode.user.js`
3. *Enregistrer le fichier* → choisir le dossier des userscripts,
   **désactiver** « Demander où enregistrer » et **activer** « Écraser si le
   fichier existe »
4. Onglet **Automatisation** → *Heure de la journée* → une fois par jour →
   exécuter ce raccourci

Aucune CSP, aucun `eval` : l'extension recharge simplement un fichier local qui
a changé.

## Utilisation

Le panneau s'ajoute en haut des pages **Paramètres** et **Inventaire**, aux
couleurs du site. Il contient trois cartes.

**Robux** — fixe le solde simulé, ajoute des montants rapides, active ou coupe
le mode test. Le solde de l'en-tête est réécrit, et les réponses de l'API
économie sont réécrites elles aussi pour que le site affiche lui-même la valeur.

**Identité** — cherche un pseudo sur le vrai Roblox et emprunte son profil.
Plutôt que de maquiller les réponses, le script réécrit l'URL des requêtes de
profil : le site demande alors à Roblox les données du compte emprunté et
affiche ses vrais amis, abonnés, badges, groupes, favoris et créations. La liste
des endpoints détournés est une liste blanche (`PROFILE_ENDPOINTS`) ; tout ce
qui touche au compte réel — solde, paramètres, inventaire simulé — reste
intact. L'identifiant numérique du compte connecté est conservé, sinon les
propres appels du site casseraient.

**Inventaire simulé** — les articles achetés en mode test sont conservés avec
leur nom, leur prix et leur vignette réels, récupérés au passage sur les pages
catalogue. Ils sont ajoutés aux réponses de l'API inventaire et à la grille de
la page. Un interrupteur recharge la page après chaque achat, comme après un
achat réel.

Depuis la console : `rbxTest.panel()` ouvre le panneau en flottant,
`rbxTest.setBalance(n)` fixe le solde, `rbxTest.spoof('pseudo')` emprunte une
identité, `rbxTest.unspoof()` la rend, `rbxTest.reset()` remet tout à zéro.

## Limites

Rien ne quitte le navigateur : les achats sont interceptés avant l'envoi, et le
serveur de Roblox ignore tout de ces articles et de ce solde. L'inventaire
simulé disparaît sur un autre appareil, un autre navigateur ou après un vidage
du stockage local. Le bandeau rouge est permanent et ne se masque pas sans
éditer ce fichier.
