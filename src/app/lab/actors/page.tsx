import type { Metadata } from 'next';
import { CharacterLab } from '@/components/dev/CharacterLab';

export const metadata: Metadata = {
  title: 'Character Lab — A Mesa Engine',
  description: 'Bancada de validação visual e técnica dos atores da mesa.',
  robots: { index: false, follow: false },
};

export default function CharacterLabPage() {
  return <CharacterLab />;
}

