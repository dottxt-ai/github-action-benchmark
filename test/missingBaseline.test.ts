import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Config } from '../src/config';
import { Benchmark } from '../src/extract';
import { buildComment, writeBenchmark } from '../src/write';
import { leavePRComment } from '../src/comment/leavePRComment';
import * as core from '@actions/core';

jest.mock('../src/comment/leavePRComment', () => ({ leavePRComment: jest.fn() }));
jest.mock('@actions/github', () => ({
    context: {
        repo: { owner: 'owner', repo: 'repo' },
        payload: { repository: { html_url: 'https://github.com/owner/repo' }, pull_request: { number: 42 } },
        workflow: 'benchmark',
    },
}));

const current: Benchmark = {
    commit: { id: 'current', author: {}, committer: {}, message: '', url: '' },
    date: 0,
    tool: 'customSmallerIsBetter',
    benches: [
        { name: 'existing', value: 20, unit: 'ms' },
        { name: 'new', value: 5, unit: 'ms' },
    ],
};

describe('reporting without previous results', () => {
    it('renders the current values and marks the missing baseline', () => {
        const comment = buildComment('Suite', current, null);
        expect(comment).toContain('Previous: no previous results');
        expect(comment).toContain('| `existing` | `20 ms` | — | — |');
        expect(comment).toContain('| `new` | `5 ms` | — | — |');
    });

    it('compares matching benchmarks and shows new benchmarks in the same table', () => {
        const previous: Benchmark = {
            ...current,
            commit: { ...current.commit, id: 'previous' },
            benches: [{ name: 'existing', value: 10, unit: 'ms' }],
        };
        const comment = buildComment('Suite', current, previous);
        expect(comment).toContain('Previous: previous');
        expect(comment).toContain('| `existing` | `20 ms` | `10 ms` | `2` |');
        expect(comment).toContain('| `new` | `5 ms` | — | — |');
    });

    it('sends a PR comment and job summary on a first run without raising an alert', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'benchmark-first-run-'));
        const summaryAdd = jest.spyOn(core.summary, 'addRaw');
        const summaryWrite = jest.spyOn(core.summary, 'write').mockResolvedValue(core.summary);
        const config: Config = {
            name: 'Suite',
            tool: current.tool,
            outputFilePath: '',
            ghPagesBranch: '',
            ghRepository: undefined,
            benchmarkDataDirPath: '',
            githubToken: 'token',
            autoPush: false,
            skipFetchGhPages: false,
            commentAlways: true,
            summaryAlways: true,
            saveDataFile: false,
            commentOnAlert: true,
            alertThreshold: 0,
            failOnAlert: true,
            alertCommentCcUsers: [],
            externalDataJsonPath: path.join(dir, 'missing.json'),
            maxItemsInChart: null,
            failThreshold: 0,
            ref: undefined,
        };
        try {
            await writeBenchmark(current, config);
            expect(leavePRComment).toHaveBeenCalledTimes(1);
            expect(leavePRComment).toHaveBeenCalledWith(
                'owner',
                'repo',
                42,
                expect.stringContaining('| `new` | `5 ms` | — | — |'),
                'Suite Summary',
                'token',
            );
            expect(summaryAdd).toHaveBeenCalledWith(expect.stringContaining('Previous: no previous results'));
            expect(summaryWrite).toHaveBeenCalledTimes(1);
        } finally {
            summaryAdd.mockRestore();
            summaryWrite.mockRestore();
            await fs.rmdir(dir);
        }
    });
});
