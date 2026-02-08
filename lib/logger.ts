export const logger = {
  log: (...messages: any[]) => {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log(new Date().toISOString(), ...messages);
    }
  },
  error: (...messages: any[]) => {
    // eslint-disable-next-line no-console
    console.error(new Date().toISOString(), ...messages);
  },
};
