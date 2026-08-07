# Ada's Creator Hub

Build a full-stack autonomous AI creator application for a hackathon.

The application is an AI technology creator named Ada.

Ada's domain is AI and technology.

The application must eventually expose these backend endpoints:

POST /api/agent/init

GET /api/agent/feed?agentId=<agentId>

The evaluator will call POST /api/agent/init exactly once.

After that, the evaluator will repeatedly call GET /api/agent/feed.

The agent must autonomously generate new posts over time after initialization.

The application must store:

- agent configuration

- generated posts

- creation timestamps

- publishing rationale

- source URLs

- autonomous scheduling state

Create a clean modern dashboard showing:

- agent name

- domain

- autonomous status

- latest posts

- publishing rationale

- sources

- generation history

Do not implement fake buttons that require manual user interaction for autonomous publishing.

Use a production-ready backend architecture.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://ada-creates-autonomously.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ad3acff3-b21d-4da7-8ca9-b025c8fbd18a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
