---
name: UBChaos
description: Ultimate Bravery entre amis : crée un salon, envoie le lien, chacun choisit son champion et tire son build.
tags: [Jeu]
links:
  - label: Jouer
    url: https://ubchaos.theston.workers.dev
cover: cover.png
coverAlt: Logo UBChaos sur un fond de fumée turquoise, au-dessus d'une capture d'un salon où trois joueurs ont tiré leur build
icon: icon.png
screenshots:
  - src: screenshots/accueil.png
    alt: Écran d'accueil de UBChaos
    caption: Créer un salon ou en rejoindre un avec son code
  - src: screenshots/choix-champion.png
    alt: Choix du rôle et du champion dans un salon
    caption: Chacun choisit son rôle et son champion, ou laisse le hasard décider
  - src: screenshots/salon.png
    alt: Salon à trois joueurs avec leurs builds
    caption: Les builds de tout le salon, synchronisés en direct
  - src: screenshots/carte.png
    alt: Carte d'un joueur exportée en image
    caption: Sa carte copiée en image, prête à partager
  - src: screenshots/apercu-discord.png
    alt: Image d'aperçu d'un lien UBChaos dans Discord
    caption: L'aperçu affiché quand on partage un lien dans Discord
technologies: [TypeScript, JavaScript, Cloudflare Workers, Durable Objects]
platforms: [Web]
status: Maintenu
---

UBChaos tire des builds aléatoires à la Ultimate Bravery pour League of Legends, à jouer entre amis.

L'hôte crée un salon et partage son code ou son lien. Jusqu'à 10 joueurs le rejoignent, et tout le monde voit les builds des autres en direct.

- **Trois modes** : Normal (avec un rôle), ARAM et ARAM du Chaos. En ARAM du Chaos, le build dit aussi quelles optimisations relancer et lesquelles prendre, ainsi que la carte à choisir pour le bonus de stats.
- **Un build complet** : objets, runes, sorts d'invocateur et ordre des compétences. Le tirage respecte les règles du jeu : pas d'objets incompatibles entre eux, ni d'objets réservés aux champions à distance pour un champion de mêlée.
- **Réglages du salon** : jusqu'à 5 builds au choix, et un nombre de rerolls limité (jusqu'à 10) ou illimité.
- **Gestion du salon** : l'hôte peut nommer un autre hôte, exclure un joueur et verrouiller les builds. Chaque joueur peut verrouiller le sien.
- **Partage** : chacun copie sa carte en image, et les liens de salon s'affichent avec un aperçu dans Discord.

Les données du jeu viennent de Data Dragon : le site suit automatiquement chaque patch.
