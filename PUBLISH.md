# Publishing to npm

This document outlines the steps to publish `@stalkchain/grpc-pool` to npm.

## Pre-publish Checklist

### 1. Code Quality
- [ ] Build succeeds: `npm run build`
- [ ] TypeScript compilation is clean
- [ ] Linting check (optional): `npm run lint`

### 2. Documentation
- [ ] README.md is up to date
- [ ] All examples work correctly
- [ ] API documentation is complete
- [ ] CHANGELOG.md is updated (if exists)

### 3. Package Configuration
- [ ] `package.json` version is correct
- [ ] All dependencies are properly listed
- [ ] `files` array includes only necessary files
- [ ] `.npmignore` excludes development files
- [ ] License file exists and is correct

### 4. Testing
- [ ] Run `npm pack` to test package contents
- [ ] Verify the generated tarball contains only necessary files
- [ ] Test installation in a separate project

## Publishing Steps

### 1. Login to npm
```bash
npm login
```

### 2. Verify Package Contents
```bash
# Create a test package to verify contents
npm pack

# Extract and inspect
tar -tzf stalkchain-grpc-pool-*.tgz

# Clean up
rm stalkchain-grpc-pool-*.tgz
```

### 3. Publish
```bash
# For first-time publishing or major releases
npm publish

# For beta/alpha releases
npm publish --tag beta
npm publish --tag alpha
```

### 4. Verify Publication
```bash
# Check if package is available
npm view @stalkchain/grpc-pool

# Test installation
mkdir test-install && cd test-install
npm init -y
npm install @stalkchain/grpc-pool
```

## Post-publish Steps

1. **Create GitHub Release**
   - Tag the release: `git tag v1.0.0`
   - Push tags: `git push --tags`
   - Create release notes on GitHub

2. **Update Documentation**
   - Update any external documentation
   - Notify users of the new release

3. **Monitor**
   - Check npm download stats
   - Monitor for issues or bug reports

## Version Management

Follow semantic versioning (semver):
- **MAJOR** (1.0.0): Breaking changes
- **MINOR** (0.1.0): New features, backward compatible
- **PATCH** (0.0.1): Bug fixes, backward compatible

```bash
# Update version
npm version patch   # 1.0.0 -> 1.0.1
npm version minor   # 1.0.0 -> 1.1.0
npm version major   # 1.0.0 -> 2.0.0
```

## Troubleshooting

### Common Issues

1. **403 Forbidden**
   - Ensure you're logged in: `npm whoami`
   - Check package name availability
   - Verify organization permissions

2. **Package Size Too Large**
   - Check `.npmignore` file
   - Remove unnecessary files
   - Use `npm pack` to verify contents

3. **Missing Files**
   - Update `files` array in `package.json`
   - Ensure build artifacts are included

### Useful Commands

```bash
# Check what will be published
npm publish --dry-run

# View package info
npm view @stalkchain/grpc-pool

# Check package size
npm pack --dry-run

# List all versions
npm view @stalkchain/grpc-pool versions --json
```

## Security

- Never publish with credentials or API keys
- Review `.npmignore` to ensure sensitive files are excluded
- Use `npm audit` to check for vulnerabilities
- Consider using `npm publish --otp` for two-factor authentication

## Support

For issues with publishing:
1. Check npm status: https://status.npmjs.org/
2. Review npm documentation: https://docs.npmjs.com/
3. Contact npm support if needed
