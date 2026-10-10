const net = require("node:net");

async function reserve() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

(async () => {
  const app = await reserve();
  const mock = await reserve();
  const appPort = app.address().port;
  const mockPort = mock.address().port;
  const base = `http://127.0.0.1:${appPort}`;
  console.log([
    `STAMPCHAIN_PORT=${appPort}`,
    `MOCK_API_PORT=${mockPort}`,
    "HOSTNAME=127.0.0.1",
    `DEV_BASE_URL=${base}`,
    `APP_BASE_URL=${base}`,
    `XCP_API_URL=http://127.0.0.1:${mockPort}/v2`,
    `MEMPOOL_API_URL=http://127.0.0.1:${mockPort}/mempool/api`,
    `BLOCKSTREAM_API_URL=http://127.0.0.1:${mockPort}/blockstream/api`,
  ].join("\n"));
  await Promise.all([app, mock].map((server) =>
    new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  ));
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
