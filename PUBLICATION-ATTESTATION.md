# Publication attestation

Groundwork 0.5.0 is published under Apache 2.0 from a clean source snapshot.
This repository does not import earlier Git history, issues, pull requests,
Actions logs, releases, or uncommitted working-directory files.

The public tree contains product code, current usage and integration contracts,
bundled design guidance, and tests. Project design records, captured project
dashboards, preference journals, maintainer plans, review transcripts, and local
registry entries remain in their original private locations. Planner and
notes-import fixtures are synthetic examples. Visual-scan fixtures retain
anonymous style measurements with neutral example text. The planner PNG was
captured through IBR from the included synthetic HTML.

Verification uses the complete deterministic source/browser gate (`npm test`),
publication-boundary regression checks, and TruffleHog scanning of the public
Git history without credential verification. Intentional fake credentials in
security tests are reviewed as synthetic fixtures. These checks do not certify
an absolute absence of undiscovered sensitive data or third-party rights.

NOTICE records human authorship, AI assistance, and bundled guidance provenance.
The first public commit is the publication baseline; its Git tree identifies
the exact published bytes. CI rebuilds the plugin from the checked-out commit,
runs the source gate, and generates a GitHub artifact provenance attestation
for the downloadable bundle. Verify a downloaded bundle with:

```sh
gh attestation verify groundwork-plugin.tar.gz -R tyroneross/groundwork-public
```

Artifact provenance identifies the workflow and source used. It does not
certify privacy, authenticated host activation, or model quality. The Actions
run and attestation verification result are the evidence of successful issuance.

Future contributions must keep personal data and generated project records out
of Git. Ignore rules and publication-boundary checks guard the exclusions.
