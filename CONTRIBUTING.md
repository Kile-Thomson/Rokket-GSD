# Contributing to Rokket GSD

Thanks for your interest in contributing to Rokket GSD!

## Reporting Bugs

Open an [issue](https://github.com/Kile-Thomson/Rokket-GSD/issues/new?template=bug_report.md) with:

- Your OS and VS Code version
- The `gsd-pi` version (`gsd --version`)
- Steps to reproduce
- What you expected vs what happened
- Any relevant console output (Help > Toggle Developer Tools)

## Feature Requests

Open an [issue](https://github.com/Kile-Thomson/Rokket-GSD/issues/new?template=feature_request.md) describing the feature and why it would be useful.

## Pull Requests

1. Fork the repo and create a branch from `main`
2. `npm install` and `npm run build` to verify the build works
3. Make your changes
4. Run `npm test` and ensure all tests pass
5. Open a PR with a clear description of the change

### Development Setup

```bash
git clone https://github.com/YOUR_USERNAME/Rokket-GSD.git
cd Rokket-GSD
npm install
npm run watch
# Press F5 in VS Code to launch Extension Development Host
```

### Code Style

- TypeScript throughout, no `any` unless unavoidable
- No frameworks in the webview (vanilla DOM)
- Run `npm run lint` before submitting

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
