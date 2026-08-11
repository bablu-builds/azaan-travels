import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.azaancommunication.csc',
  appName: 'Azaan CSC',
  webDir: 'dist',
  server: {
    url: 'https://csc-dashboard-b132b.web.app',
    cleartext: false,
  },
};

export default config;
