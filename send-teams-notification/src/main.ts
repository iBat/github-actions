import * as core from '@actions/core'
import fs from 'fs';
import { context, getOctokit } from '@actions/github'
import { IncomingWebhook } from 'ms-teams-webhook';

type GithubContext = typeof context;

async function run(): Promise<void> {
    try {
        const hook = core.getInput('hook_url', { required: true });
        const alertsRaw = core.getInput('alerts', { required: false });
        const alerts = alertsRaw && JSON.parse(alertsRaw);

        const webhook = new IncomingWebhook(hook);
        if (alerts) {
            await notifyCodeQlAlerts(alerts, webhook);
        } else {
            const ghToken = core.getInput('bearer_token', { required: false });
            const onlyOnPush = core.getInput('only_on_push', { required: false }) === 'true';
            const specificRepo = core.getInput('specific_repo', { required: false });
            const specificBranch = core.getInput('specific_branch', { required: false });
            const { eventName, repo, ref, runId }: GithubContext = context;

            if (onlyOnPush && eventName !== 'push') {
                return;
            }
            if (specificRepo && specificRepo !== `${repo.owner}/${repo.repo}`) {
                return;
            }
            if (specificBranch && specificBranch !== ref) {
                return;
            }

            const octokit = getOctokit(ghToken);
            const runInfo = await octokit.request('GET /repos/{owner}/{repo}/actions/runs/{runId}', {
                owner: repo.owner,
                repo: repo.repo,
                runId
            });

            await notifyFailedWorkflow(runInfo.data, webhook);
        }
    } catch (error) {
        core.setFailed(`analyze action failed: ${error}`);
        console.log(error);
    }
}

async function notifyCodeQlAlerts(alerts: Array<any>, webhook: IncomingWebhook) {
    const alertsCacheFile = core.getInput('alerts_cache_file', { required: false });
    let notify_cache: { [key: string]: Object } = {};

    if (fs.existsSync(alertsCacheFile)) {
        notify_cache = JSON.parse(fs.readFileSync(alertsCacheFile).toString());
    }

    for (let alert of alerts) {
        if (alert.state === 'open') {
            if (!notify_cache[alert.number]) {
                notify_cache[alert.number] = true;
                await webhook.send(JSON.stringify({
                    '@type': 'MessageCard',
                    '@context': 'https://schema.org/extensions',
                    'summary': 'New security alert found',
                    'themeColor': '#ff7500',
                    'sections': [
                        {
                            'heroImage': {
                                'image': 'https://cdn-icons-png.flaticon.com/512/2438/2438078.png'
                            }
                        },
                        {
                            'startGroup': true,
                            'title': '**New CodeQL alert**',
                            'facts': [
                                {
                                    'name': 'Rule:',
                                    'value': `[${alert.rule.id}](${alert.html_url})`
                                },
                                {
                                    'name': 'Rule Description:',
                                    'value': `${alert.rule.description}`
                                },
                                {
                                    'name': 'Alert Severity:',
                                    'value': `${alert.rule.severity}`
                                },
                                {
                                    'name': 'Date submitted:',
                                    'value': alert.created_at.toLocaleString()
                                },
                                {
                                    'name': 'Found In (or earlier):',
                                    'value': `[${alert.most_recent_instance.commit_sha}](https://github.com/iBat/codeql-test/commit/${alert.most_recent_instance.commit_sha})`
                                },
                            ]
                        }
                    ]
                }));
            }
        }
    }

    fs.writeFileSync(alertsCacheFile, JSON.stringify(notify_cache));
}

async function notifyFailedWorkflow(runInfo: any, webhook: IncomingWebhook) {
    const { repo, workflow }: GithubContext = context;

    await webhook.send(JSON.stringify({
        '@context': 'https://schema.org/extensions',
        '@type': 'MessageCard',
        'text': 'Run failed',
        'sections': [
            {
                'facts': [
                    {
                        'name': 'Repository',
                        'value': `[${repo.owner}/${repo.repo}](https://github.com/${repo.owner}/${repo.repo})`
                    },
                    {
                        'name': 'Workflow',
                        'value': workflow
                    },
                    {
                        'name': 'Committer',
                        'value': runInfo.head_commit.author.name
                    },
                    {
                        'name': 'Commit',
                        'value': `[${runInfo.head_commit.message}](https://github.com/${repo.owner}/${repo.repo}/commit/${runInfo.head_commit.id})`
                    }
                ]
            }
        ],
        'potentialAction': [
            {
                '@type': 'OpenUri',
                'name': 'View in GitHub',
                'targets': [
                    {
                        'os': 'default',
                        'uri': runInfo.html_url
                    }
                ]
            }
        ]
    }));
}

run()
