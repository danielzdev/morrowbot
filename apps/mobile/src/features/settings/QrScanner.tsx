import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';

/** The camera, reading QR codes only. Each distinct code is reported once. */
export function QrScanner(props: { readonly onScan: (text: string) => void }) {
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const last = useRef<string | null>(null);

  if (permission === null) return <View style={[styles.frame, { backgroundColor: colors.surface3 }]} />;
  if (!permission.granted) {
    return (
      <View style={[styles.frame, styles.center, { backgroundColor: colors.surface3 }]}>
        <Text style={[typography.ui, styles.centerText, { color: colors.text2 }]}>
          {permission.canAskAgain ? 'Ori Bot needs the camera to scan the pairing QR code.' : 'Allow camera access for Ori Bot in the Settings app, or type the code instead.'}
        </Text>
        {permission.canAskAgain ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void requestPermission();
            }}
            style={[styles.allow, { backgroundColor: colors.accent }]}
          >
            <Text style={[typography.ui, { color: colors.onAccent, fontWeight: '600' }]}>Allow Camera</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  return (
    <View style={styles.frame}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (data === last.current) return;
          last.current = data;
          props.onScan(data);
        }}
      />
      <View pointerEvents="none" style={[styles.reticle, { borderColor: colors.accent }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { aspectRatio: 1, borderRadius: radii.xl, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  center: { padding: spacing[6], gap: spacing[4] },
  centerText: { textAlign: 'center' },
  allow: { paddingHorizontal: spacing[5], paddingVertical: spacing[3], borderRadius: radii.pill },
  reticle: { width: '62%', aspectRatio: 1, borderWidth: 3, borderRadius: radii.lg },
});
