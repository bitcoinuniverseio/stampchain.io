import { Micro5FontLoader } from "$layout";

export default function PressKit() {
  return (
    <>
      <Micro5FontLoader />
      <div class="text-color-grey-semilight flex flex-col gap-16 tablet:gap-36 py-24 tablet:py-48">
        <section class="text-center max-w-full mx-auto">
          <h1 class="text-3xl tablet:text-6xl font-bold">
            <span class="text-4xl tablet:text-7xl font-black color-grey-gradientDL">
              PRESS KIT
            </span>
            <br />
            BRAND ASSETS
          </h1>
        </section>

        <section class="flex flex-col tablet:flex-row gap-6 tablet:gap-12">
          <div class="flex flex-col gap-6 tablet:gap-12 w-full tablet:w-1/2">
            <div>
              <h1 class="text-3xl tablet:text-6xl font-black color-grey-gradientLD mb-2">
                BITCOIN STAMPS
              </h1>
              <h2 class="text-2xl tablet:text-5xl font-extralight mb-3">
                THE PROTOCOL
              </h2>
              <p class="text-sm tablet:text-lg font-medium">
                Bitcoin Stamps is a meta-protocol that stores data directly in
                Bitcoin's UTXO set. Because the data lives in unspent outputs
                rather than in witness data, a Stamp cannot be pruned and cannot
                be accidentally spent away. The first official Stamp was created
                in block 779,652.
              </p>
            </div>

            <div>
              <h2 class="text-2xl tablet:text-5xl font-extralight mb-3">
                WORDMARK
              </h2>
              <p class="text-sm tablet:text-lg font-medium">
                The Bitcoin Stamps wordmark is set in Micro 5, a pixel typeface,
                shown here in the orange used across stampchain.io.
              </p>
            </div>

            <div>
              <h2 class="text-2xl tablet:text-5xl font-extralight mb-3">
                SUB-PROTOCOLS
              </h2>
              <p class="text-sm tablet:text-lg font-medium">
                Classic Stamps carry images and can use a built-in token layer
                via Counterparty standards. SRC-20 is a fair-mint fungible token
                standard where users pay standard BTC miner fees only; the first
                SRC-20 token, KEVIN, was deployed in block 788,041. SRC-721
                composes layered artwork from multiple Stamps. SRC-101 is a
                naming system built on Stamps.
              </p>
            </div>
          </div>

          <div class="text-color-orange-light flex flex-col items-center tablet:items-end gap-3 tablet:gap-6 w-full tablet:w-1/2 font-micro-5">
            <p class="text-4xl tablet:text-7xl">BITCOIN STAMPS</p>
            <p class="text-6xl tablet:text-9xl">STAMPS</p>
          </div>
        </section>

        <section class="flex flex-col tablet:flex-row gap-6 tablet:gap-12">
          <div class="flex flex-col gap-6 tablet:gap-12 w-full tablet:w-1/2">
            <div>
              <h1 class="text-3xl tablet:text-6xl font-black color-grey-gradientLD mb-2">
                STAMPCHAIN
              </h1>
              <h2 class="text-2xl tablet:text-5xl font-extralight mb-3">
                THE EXPLORER
              </h2>
              <p class="text-sm tablet:text-lg font-medium">
                Stampchain is the block explorer and public API for Bitcoin
                Stamps. It serves stamp, SRC-20, SRC-721 and SRC-101 data read
                from the Bitcoin Stamps indexer. The API is described by an
                OpenAPI 3.0 contract and is browsable at /docs.
              </p>
            </div>

            <div>
              <h2 class="text-2xl tablet:text-5xl font-extralight mb-3">
                WORDMARK
              </h2>
              <p class="text-sm tablet:text-lg font-medium">
                Two lockups: STAMPCHAIN on its own, and STAMPCHAIN.IO with the
                domain suffix set lighter than the name. Both are italic and use
                the purple gradient shown below.
              </p>
            </div>

            <div>
              <h2 class="text-2xl tablet:text-5xl font-extralight mb-3">
                LOGO MARKS
              </h2>
              <p class="text-sm tablet:text-lg font-medium">
                Six SVG marks at 1000px: the stamp logo and the stamp logo with
                the Bitcoin symbol, each in the base, medium purple and light
                purple treatments. Click any mark below to open the SVG.
              </p>
            </div>

            <div>
              <h2 class="text-2xl tablet:text-5xl font-extralight mb-3">
                COLOR PALETTE
              </h2>
              <p class="text-sm tablet:text-lg font-medium">
                The purple ramp runs dark to light across five steps and carries
                the brand. The grey ramp is the interface palette, used for
                text, borders and surfaces against the dark background. Both are
                shown at the bottom of this page.
              </p>
            </div>

            <div class="mt-5 flex flex-col items-center">
              <img
                src="/img/logo/stampchain-logo-480.svg"
                alt="Stampchain logo"
                class="max-w-full h-auto"
              />
            </div>
          </div>

          <div class="flex flex-col items-center tablet:items-end gap-6 tablet:gap-12 w-full tablet:w-1/2">
            <p class="color-purple-gradientDL text-4xl tablet:text-7xl font-black italic px-2">
              STAMPCHAIN
            </p>
            <p class="color-purple-gradientLD text-4xl tablet:text-7xl font-black italic px-2">
              STAMPCHAIN<span class="font-extralight">.IO</span>
            </p>
            <div class="flex gap-6">
              <a href="/img/presskit/stamp-logo-1000.svg">
                <img
                  src="/img/presskit/stamp-logo-1000.svg"
                  alt="Stamp logo"
                />
              </a>
              <a href="/img/presskit/stamp-logo-purpleMedium-1000.svg">
                <img
                  src="/img/presskit/stamp-logo-purpleMedium-1000.svg"
                  alt="Stamp logo, medium purple"
                />
              </a>
              <a href="/img/presskit/stamp-logo-purpleLight-1000.svg">
                <img
                  src="/img/presskit/stamp-logo-purpleLight-1000.svg"
                  alt="Stamp logo, light purple"
                />
              </a>
            </div>
            <div class="flex gap-6">
              <a href="/img/presskit/stamp-logo-btc-1000.svg">
                <img
                  src="/img/presskit/stamp-logo-btc-1000.svg"
                  alt="Stamp logo with Bitcoin symbol"
                />
              </a>
              <a href="/img/presskit/stamp-logo-btc-purpleMedium-1000.svg">
                <img
                  src="/img/presskit/stamp-logo-btc-purpleMedium-1000.svg"
                  alt="Stamp logo with Bitcoin symbol, medium purple"
                />
              </a>
              <a href="/img/presskit/stamp-logo-btc-purpleLight-1000.svg">
                <img
                  src="/img/presskit/stamp-logo-btc-purpleLight-1000.svg"
                  alt="Stamp logo with Bitcoin symbol, light purple"
                />
              </a>
            </div>
          </div>
        </section>

        <section class="flex flex-col gap-10">
          <div class="flex gap-10">
            <div class="bg-white rounded-md p-6 flex gap-6">
              <div class="bg-color-purple-dark w-12 h-12 rounded-[3px]" />
              <div class="bg-color-purple-semidark w-12 h-12 rounded-[3px]" />
              <div class="bg-color-purple w-12 h-12 rounded-[3px]" />
              <div class="bg-color-purple-semilight w-12 h-12 rounded-[3px]" />
              <div class="bg-color-purple-light w-12 h-12 rounded-[3px]" />
            </div>
          </div>
          <div class="flex gap-10">
            <div class="bg-white rounded-md p-6 flex gap-6">
              <div class="bg-color-grey-dark w-12 h-12 rounded-[3px]" />
              <div class="bg-color-grey-semidark w-12 h-12 rounded-[3px]" />
              <div class="bg-color-grey w-12 h-12 rounded-[3px]" />
              <div class="bg-color-grey-light w-12 h-12 rounded-[3px]" />
              <div class="bg-color-background w-12 h-12 rounded-[3px]" />
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
