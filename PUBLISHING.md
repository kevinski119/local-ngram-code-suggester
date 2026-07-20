# Publishing the attributed fork

The VSIX is release-ready only after `npm run release:check` passes.

## One-time identity work

1. Create a unique Visual Studio Marketplace publisher.
2. Replace `pending-publisher-id` in `extension/package.json`.
3. Regenerate the starter model from the exact public release revision if its
   training sources change.
4. Enable private vulnerability reporting for the GitHub repository.
5. Capture the real assets listed in
   `extension/assets/marketplace/README.md` and link them from the extension
   README through HTTPS URLs.

Do not change or remove the original copyright notice in `LICENSE`.

## Validate

```bash
cd extension
npm ci
npm test
npm run test:integration
npm run package
npm run test:vsix
npm audit
npm run release:check
```

Also run the Python tests and benchmark from the repository root.

## First public release

1. Create a signed `v2.0.0` Git tag from the exact validated commit.
2. Build the VSIX from that clean tag.
3. Upload the VSIX manually through the Marketplace publisher management page.
4. Verify the Marketplace README, icon, links, license, install, commands, and
   privacy wording.
5. Attach the identical VSIX and checksum to the GitHub release.

The first release intentionally does not keep publishing credentials in GitHub.
For later automation, follow the current official Visual Studio Code guidance
for Microsoft Entra workload identity and `vsce publish --azure-credential`.
Avoid building a new workflow around a long-lived global Azure DevOps PAT.

Official documentation:

- https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- https://code.visualstudio.com/api/references/extension-manifest
