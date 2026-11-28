import { useEffect, useRef } from 'react';
import { Alert, Linking } from 'react-native';
import { pairProblem, type HostConnection } from '../../lib/host-connection.ts';
import { parsePairingLink, type PairingTarget } from '../../lib/pairing-link.ts';

/**
 * Pairs from an `oribot://pair` link, as when the system Camera scans the desktop's QR code.
 * It asks first, so a link from anywhere else cannot pair this phone with a stranger's host.
 */
export function usePairingLinks(pair: HostConnection['pair']): void {
  const pairRef = useRef(pair);
  pairRef.current = pair;

  useEffect(() => {
    const confirm = (target: PairingTarget): void => {
      Alert.alert('Pair with this host?', `${target.url}\n\nOnly pair with a computer you own.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Pair',
          onPress: () => {
            void pairRef.current(target).then((outcome) => {
              const problem = pairProblem(outcome);
              if (outcome.kind === 'paired') Alert.alert('Paired', `Connected to ${outcome.host.hostName}.`);
              else if (problem !== null) Alert.alert('Could not pair', problem);
            });
          },
        },
      ]);
    };
    const open = (url: string | null | undefined): void => {
      if (url == null || !/^oribot:/i.test(url)) return;
      const input = parsePairingLink(url);
      switch (input.kind) {
        case 'ok':
          confirm(input.target);
          return;
        case 'invalid':
          Alert.alert('Could not pair', input.problem);
          return;
      }
    };
    void Linking.getInitialURL().then(open);
    const subscription = Linking.addEventListener('url', ({ url }) => {
      open(url);
    });
    return () => {
      subscription.remove();
    };
  }, []);
}
