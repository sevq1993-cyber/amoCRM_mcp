export const nowIso = () => new Date().toISOString();

export const addSeconds = (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000);

export const sleep = async (ms: number) =>
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
