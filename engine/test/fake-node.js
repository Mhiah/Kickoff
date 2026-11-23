// A stand-in for an X Layer node, for the tests. It holds a league's inbox and its site the way
// TapeOut's mailbox and site store do, and answers the same questions a real node answers. It can
// also be told to misbehave, to check the fetcher does not believe a node that does.
import { createHash } from "node:crypto";

import { decode, encode, selector } from "../src/abi.js";
import { XLAYER, fromHex, keccak256, toHex } from "../src/index.js";

const hex = (bytes) => `0x${toHex(bytes)}`;
const code = (signature) => toHex(selector(signature));
const SENT = "0xd75bb8082dd3ae8bb88682115ee1412a8e8051cc81d0e4c01dc3b06c0cf61020"; // as TAP-10 publishes it
const reverted = () => Object.assign(new Error("execution reverted"), { code: 3 });
const sha256 = (bytes) => new Uint8Array(createHash("sha256").update(bytes).digest());
const join = (a, b) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

export class FakeNode {
  /**
   * @param league    the league's id
   * @param messages  the inbox, as test/chain.js's Inbox holds it
   * @param files     the league's site: { path: text }
   */
  constructor({ league, messages, files = {}, chainId = 196, perBlock = 2 }) {
    this.league = hex(league);
    this.chainId = chainId;
    this.mailbox = XLAYER.mailbox;
    this.sites = XLAYER.sites;
    this.firstBlock = 5000;
    this.entries = messages.map((m, i) => ({
      ...m,
      block: this.firstBlock + Math.floor(i / perBlock),
      digest: keccak256(join(m.ref, keccak256(m.payload))),
    }));
    this.head = this.firstBlock + Math.ceil(messages.length / perBlock) + 3;
    this.files = Object.fromEntries(
      Object.entries(files).map(([path, textOrBytes]) => {
        const bytes = typeof textOrBytes === "string" ? new TextEncoder().encode(textOrBytes) : textOrBytes;
        return [path, { bytes, declared: sha256(bytes), pieces: 1 }];
      }),
    );
    // Ways to misbehave.
    this.servesPages = true;
    this.servesLogs = true;
    this.changeLogs = (logs) => logs;
    this.failOn = null; // a method name to fail on, as a node that is down would
    this.asked = [];
    this.ask = this.ask.bind(this);
  }

  logsIn(block) {
    return this.entries
      .filter((e) => e.block === block)
      .map((e) => ({
        address: this.mailbox,
        blockNumber: `0x${block.toString(16)}`,
        topics: [SENT, this.league, `0x${e.from.replace(/^0x/, "").padStart(64, "0")}`, hex(e.ref)],
        data: hex(encode(["uint256", "uint256", "bytes"], [e.index, 0, e.payload])),
      }));
  }

  entryWords(e) {
    return [e.from, e.block, e.timestamp, e.digest];
  }

  call({ to, data }) {
    const bytes = fromHex(data);
    const which = toHex(bytes.subarray(0, 4));
    const args = bytes.subarray(4);
    const target = String(to).toLowerCase();
    const ENTRY = ["address", "uint256", "uint256", "bytes32"];

    if (target === this.mailbox) {
      if (which === code("inboxCount(bytes32)")) {
        const [inbox] = decode(["bytes32"], args);
        return encode(["uint256"], [hex(inbox) === this.league ? this.entries.length : 0]);
      }
      if (which === code("inboxPage(bytes32,uint256,uint256)")) {
        if (!this.servesPages) throw reverted();
        const [, start, n] = decode(["bytes32", "uint256", "uint256"], args);
        const page = this.entries.slice(Number(start), Number(start) + Math.min(Number(n), 200));
        const types = ["uint256", "uint256"];
        const values = [32, page.length];
        for (const e of page) {
          types.push(...ENTRY);
          values.push(...this.entryWords(e));
        }
        return encode(types, values);
      }
      if (which === code("inboxAt(bytes32,uint256)")) {
        const [, i] = decode(["bytes32", "uint256"], args);
        const e = this.entries[Number(i)];
        if (!e) throw reverted();
        return encode(ENTRY, this.entryWords(e));
      }
      if (which === code("accountOf(address,uint256)")) {
        const [, circuit] = decode(["address", "uint256"], args);
        if (circuit !== 7n) throw reverted();
        return encode(["address"], [`0x${this.league.slice(26)}`]);
      }
    }
    if (target === this.sites) {
      if (which === code("fileInfo(address,string)")) {
        const [, path] = decode(["address", "string"], args);
        const f = this.files[path];
        if (!f) return encode(["uint256", "string", "bytes32", "uint256", "uint256"], [0, "", new Uint8Array(32), 0, 0]);
        return encode(["uint256", "string", "bytes32", "uint256", "uint256"], [f.bytes.length, "application/json", f.declared, 1, f.pieces]);
      }
      if (which === code("readRange(address,string,uint256,uint256)")) {
        const [, path, offset, length] = decode(["address", "string", "uint256", "uint256"], args);
        const f = this.files[path];
        if (!f) throw reverted();
        return encode(["bytes"], [f.bytes.slice(Number(offset), Number(offset) + Number(length))]);
      }
    }
    throw reverted();
  }

  async ask(method, params = []) {
    this.asked.push(method);
    if (method === this.failOn) throw new Error("the node did not answer");
    if (method === "eth_chainId") return `0x${this.chainId.toString(16)}`;
    if (method === "eth_blockNumber") return `0x${this.head.toString(16)}`;
    if (method === "eth_call") return hex(this.call(params[0]));
    if (method === "eth_getLogs") {
      if (!this.servesLogs) throw new Error("this node does not serve logs");
      const { address, fromBlock, toBlock, topics } = params[0];
      if (fromBlock !== toBlock || String(address).toLowerCase() !== this.mailbox) return [];
      if (topics[0] !== SENT || topics[1] !== this.league) return [];
      return this.changeLogs(this.logsIn(Number(BigInt(fromBlock))));
    }
    if (method === "eth_getBlockReceipts") {
      const block = Number(BigInt(params[0]));
      return [{ logs: [] }, { logs: this.changeLogs(this.logsIn(block)) }];
    }
    throw new Error(`the stand-in node does not answer ${method}`);
  }
}
