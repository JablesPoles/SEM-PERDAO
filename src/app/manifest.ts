import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SEM PERDÃO* — cartas contra a humanidade',
    short_name: 'Sem Perdão',
    description:
      'O jogo de cartas mais cruel do escritório. *Nem para você. Conteúdo 18+.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f2efe9',
    theme_color: '#17161a',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
