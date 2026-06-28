# Level wording cleanup

Removed the old Expert category wording that made the backend/admin UI look related to a different style.

Current default level names:

1. Beginner
2. Easy Animals
3. Flowers
4. Cartoons
5. Hard Mandala
6. Expert

The Expert level now uses:

- id: expert
- name: Expert
- short name: Expert
- keywords: expert, hard, advanced, challenge, master

The backend also sanitizes saved level configuration before returning it to the app.
