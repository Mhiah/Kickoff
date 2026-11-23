// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IProcessor, ITransistors, IERC20, IL1FeeOracle} from "../src/ITapeOut.sol";
import {Rehearsal} from "./Rehearsal.sol";

/// The fees report. On a PRIVATE COPY of X Layer mainnet it does everything going live will do,
/// reads each fee from the chain, measures the gas of each step, and prints it all. Nothing here is
/// sent to the real network. docs/FEES.md is written from this output.
///
/// Route A creates Kickoff's own processor. It must work, so it is a real test.
/// Route B publishes on a processor somebody else created. That depends on a contract Kickoff does
/// not control, so it is a probe: it prints what it finds and cannot fail.
contract FeesTest is Rehearsal {
    /// "TapeFun", processor 409 on X Layer. Another entry's public tests found it sells NAND
    /// transistors for nothing and charges its fee in OKB.
    address constant EXISTING_PROCESSOR = 0x39E44DbA62811E87fDe122CA4d6c082568a384D0;

    /// The standard fee-quoting contract on networks built the way X Layer is.
    address constant L1_FEE_ORACLE = 0x420000000000000000000000000000000000000F;

    string constant HTML = "text/html; charset=utf-8";

    uint256 totalGas;
    uint256 totalOkbFees;
    uint256 totalBemFees;

    // ------------------------------------------------------------------ helpers

    /// The gas a transaction pays before it runs anything: a flat 21,000 plus a charge for every
    /// byte of data it carries.
    function _gasForData(bytes memory data) internal pure returns (uint256) {
        uint256 zeros;
        for (uint256 i; i < data.length; ++i) {
            if (data[i] == 0) ++zeros;
        }
        return 21_000 + 4 * zeros + 16 * (data.length - zeros);
    }

    function _line(string memory step, uint256 gasRunning, bytes memory data, uint256 okbFee, uint256 bemFee) internal {
        uint256 gasAll = gasRunning + _gasForData(data);
        totalGas += gasAll;
        totalOkbFees += okbFee;
        totalBemFees += bemFee;
        emit log_named_string("STEP", step);
        emit log_named_uint("  gas", gasAll);
        emit log_named_uint("  TapeOut fee in OKB (wei)", okbFee);
        emit log_named_uint("  TapeOut fee in BEM (smallest unit)", bemFee);
        if (L1_FEE_ORACLE.code.length > 0) {
            try IL1FeeOracle(L1_FEE_ORACLE).getL1Fee(data) returns (uint256 extra) {
                emit log_named_uint("  extra fee for posting data to Ethereum (OKB wei, approximate)", extra);
            } catch {}
        }
    }

    function _totals(string memory route) internal {
        emit log_named_string("TOTALS", route);
        emit log_named_uint("  all gas", totalGas);
        emit log_named_uint("  all TapeOut fees in OKB (wei)", totalOkbFees);
        emit log_named_uint("  all TapeOut fees in BEM (smallest unit)", totalBemFees);
        emit log_named_uint("  gas price when this ran (wei for one unit of gas)", block.basefee);
        emit log_named_uint("  so gas would cost about (OKB wei)", totalGas * block.basefee);
    }

    function _filler(uint256 len) internal pure returns (bytes memory out) {
        out = new bytes(len);
        for (uint256 i; i < len; ++i) {
            out[i] = bytes1(uint8(32 + (i * 31 + 7) % 90)); // ordinary text-like bytes, none of them zero
        }
    }

    // ------------------------------------------------------------------ route A: our own processor

    function test_report_routeA_ourOwnProcessor() public {
        vm.createSelectFork(vm.envOr("XLAYER_RPC_URL", string("https://rpc.xlayer.tech")));
        vm.deal(deployer, 10 ether);

        bem = IERC20(FACTORY.bem());
        emit log_named_string("the fee token is called", bem.symbol());
        emit log_named_uint("its decimal places", bem.decimals());
        emit log_named_address("its address", address(bem));
        emit log_named_uint("fee-quoting contract present (1 yes, 0 no)", L1_FEE_ORACLE.code.length > 0 ? 1 : 0);

        _createProcessorMeasured();
        _publishMeasured("football scoring circuit", _readScoringCircuit("football", 16), 16, 2);
        _publishMeasured("basketball scoring circuit", _readScoringCircuit("basketball", 6), 6, 2);
        _publishMeasured("tennis scoring circuit", _readScoringCircuit("tennis", 7), 7, 2);
        leagueId = _publishMeasured("the league's own circuit (one gate)", ONE_GATE, 1, 1);
        _openAccountMeasured();
        _nameMeasured();
        _totals("route A, before the site is uploaded");

        emit log_string("REPEATED COSTS (not in the totals above)");
        _sitePieceMeasured();
        _messageMeasured();
    }

    uint256 leagueId;
    address league;

    function _createProcessorMeasured() internal {
        uint256 deployFee = FACTORY.deployFee();
        deal(address(bem), deployer, deployFee);

        vm.startPrank(deployer);
        uint256 g = gasleft();
        bem.approve(address(FACTORY), deployFee);
        g -= gasleft();
        _line("allow the factory to take its BEM fee", g, abi.encodeCall(IERC20.approve, (address(FACTORY), deployFee)), 0, 0);

        g = gasleft();
        (address transistorToken, address circuits) =
            FACTORY.createCPU("Kickoff", "KICKOFF", "Scoring rules for Kickoff, the prediction game", 1_000_000, 0);
        g -= gasleft();
        vm.stopPrank();

        processor = IProcessor(circuits);
        transistors = ITransistors(transistorToken);
        _line(
            "create the Kickoff processor",
            g,
            abi.encodeCall(
                FACTORY.createCPU, ("Kickoff", "KICKOFF", "Scoring rules for Kickoff, the prediction game", 1_000_000, 0)
            ),
            0,
            deployFee
        );
    }

    function _openAccountMeasured() internal {
        uint256 openFee = OPENER.FEE();
        vm.prank(deployer);
        uint256 g = gasleft();
        league = OPENER.open{value: openFee}(address(processor), leagueId);
        g -= gasleft();
        _line("open the league's account", g, abi.encodeCall(OPENER.open, (address(processor), leagueId)), openFee, 0);
    }

    /// Switches on the site's on-chain name for twelve months.
    function _nameMeasured() internal {
        uint256 nameFee = NAMES.monthlyFee() * 12;
        string memory name =
            string.concat(vm.toString(leagueId), ".2.", vm.toString(FACTORY.cpuCount() - 1), ".tape");
        vm.prank(deployer);
        uint256 g = gasleft();
        NAMES.bind{value: nameFee}(name, league, 12);
        g -= gasleft();
        _line("switch on the site's name for 12 months", g, abi.encodeCall(NAMES.bind, (name, league, 12)), nameFee, 0);
        emit log_named_string("  the name", name);
    }

    function _sitePieceMeasured() internal {
        bytes memory piece = _filler(24_000);
        bytes32 fingerprint = sha256(piece);
        vm.prank(deployer);
        uint256 g = gasleft();
        SITES.putFile(league, "app.js", HTML, fingerprint, piece);
        g -= gasleft();
        uint256 before = totalGas;
        _line(
            "upload one full piece of the site (24,000 bytes)",
            g,
            abi.encodeCall(SITES.putFile, (league, "app.js", HTML, fingerprint, piece)),
            0,
            0
        );
        emit log_named_uint("  so one piece costs about (OKB wei)", (totalGas - before) * block.basefee);
    }

    function _messageMeasured() internal {
        bytes memory message =
            bytes.concat(hex"54530200", bytes('{"v":1,"kind":"message","subject":"Kickoff picks","body":"sealed"}'));
        bytes32 to = HUB.endpointOf(league);
        bytes32 ref = keccak256("one fingerprint covering every pick for one match");
        vm.prank(deployer);
        uint256 g = gasleft();
        HUB.send(address(processor), leagueId, to, ref, message);
        g -= gasleft();
        uint256 before = totalGas;
        _line(
            "send one message through the mailbox",
            g,
            abi.encodeCall(HUB.send, (address(processor), leagueId, to, ref, message)),
            0,
            0
        );
        emit log_named_uint("  so one message costs about (OKB wei)", (totalGas - before) * block.basefee);
    }

    function _publishMeasured(string memory what, bytes memory netlist, uint32 nIn, uint32 nOut)
        internal
        returns (uint256 id)
    {
        uint256 gates = netlist.length / 7;
        uint256 mintFee = gates * transistors.mintPrice() + transistors.protocolFee();
        uint256 tapeoutFee = processor.TAPEOUT_FEE();
        deal(address(bem), deployer, mintFee);
        uint256 g;

        vm.startPrank(deployer);
        g = gasleft();
        bem.approve(address(transistors), mintFee);
        g -= gasleft();
        _line(
            string.concat("allow the BEM fee for the transistors: ", what),
            g,
            abi.encodeCall(IERC20.approve, (address(transistors), mintFee)),
            0,
            0
        );

        g = gasleft();
        transistors.mint(NAND, gates);
        g -= gasleft();
        _line(string.concat("buy the transistors: ", what), g, abi.encodeCall(transistors.mint, (NAND, gates)), 0, mintFee);

        g = gasleft();
        id = processor.tapeout{value: tapeoutFee}(netlist, nIn, nOut);
        g -= gasleft();
        vm.stopPrank();
        _line(string.concat("publish: ", what), g, abi.encodeCall(processor.tapeout, (netlist, nIn, nOut)), tapeoutFee, 0);
    }

    // ------------------------------------------------------------------ route B: someone else's processor

    function test_probe_routeB_anExistingProcessor() public {
        vm.createSelectFork(vm.envOr("XLAYER_RPC_URL", string("https://rpc.xlayer.tech")));
        vm.deal(deployer, 10 ether);

        if (EXISTING_PROCESSOR.code.length == 0) {
            emit log_string("ROUTE B: the existing processor is not there");
            return;
        }
        IProcessor existing = IProcessor(EXISTING_PROCESSOR);
        ITransistors t = ITransistors(existing.transistors());
        uint256 price = t.mintPrice();
        uint256 flat = t.protocolFee();
        uint256 tapeoutFee = existing.TAPEOUT_FEE();
        emit log_named_address("ROUTE B: existing processor", EXISTING_PROCESSOR);
        emit log_named_uint("  price of one transistor (wei)", price);
        emit log_named_uint("  flat fee for each purchase (wei)", flat);
        emit log_named_uint("  tape-out fee (OKB wei)", tapeoutFee);
        try t.supplyCap() returns (uint256 cap) {
            emit log_named_uint("  transistors it can ever sell", cap);
        } catch {}
        try t.minted() returns (uint256 sold) {
            emit log_named_uint("  transistors sold so far", sold);
        } catch {}

        bytes[] memory netlists = new bytes[](4);
        netlists[0] = _readScoringCircuit("football", 16);
        netlists[1] = _readScoringCircuit("basketball", 6);
        netlists[2] = _readScoringCircuit("tennis", 7);
        netlists[3] = ONE_GATE;
        uint32[4] memory ins = [uint32(16), 6, 7, 1];
        uint32[4] memory outs = [uint32(2), 2, 2, 1];
        string[4] memory names = [string("football"), "basketball", "tennis", "the league's own circuit"];

        uint256 okbBefore = deployer.balance;
        for (uint256 i; i < 4; ++i) {
            uint256 gates = netlists[i].length / 7;
            uint256 cost = gates * price + flat;
            vm.prank(deployer);
            try t.mint{value: cost}(NAND, gates) {
                vm.prank(deployer);
                try existing.tapeout{value: tapeoutFee}(netlists[i], ins[i], outs[i]) returns (uint256 id) {
                    emit log_named_string("  published, paying in OKB", names[i]);
                    emit log_named_uint("    as circuit", id);
                } catch (bytes memory reason) {
                    emit log_named_string("  could not publish", names[i]);
                    emit log_named_bytes("    reason", reason);
                }
            } catch (bytes memory why) {
                emit log_named_string("  could not buy transistors with OKB", names[i]);
                emit log_named_bytes("    reason", why);
            }
        }
        emit log_named_uint("  OKB spent on TapeOut fees for all four (wei)", okbBefore - deployer.balance);
    }
}
