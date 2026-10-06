# Changelog

All notable changes to ThreadMax are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-10-06

### Added
- **Clean HD Media Downloader**: Direct full-resolution media extraction for images, videos, and multi-slide carousel posts on Threads Web.
- **Video Playback Booster**: Inline video playback speed switcher (0.5x to 2.5x) and picture-in-picture activation.
- **Clean Link Copier**: Instant URL copy with all tracking query parameters (`?xmt=...`, `?s=...`) stripped.
- **Thread Unroller**: One-click extraction of complete thread reply chains exported directly as formatted Markdown.

### Fixed
- **Unroller Formatting**: Fixed Markdown export to preserve genuine double-newline paragraph separation across nested replies.
- **DOM Scanner Resilience**: Isolated button insertion logic so dynamic feed changes never crash or re-arm the global scanner loop.
- **Avatar Detection**: Excluded high-resolution post media matching `-19/` CDN patterns from false avatar classification.
