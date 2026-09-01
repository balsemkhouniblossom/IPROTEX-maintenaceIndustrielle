# Backend

<!-- markdownlint-disable MD033 -->

<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## IMS Anomaly Integration

The `ai-anomaly` module connects the NestJS backend to the separate FastAPI IMS anomaly service. It does not train models, modify artifacts, duplicate scoring formulas, create work orders, call Gemini, or invent live IPROTEX vibration data. The backend stores audit records only after FastAPI returns a validated response.

### Local Setup

Install backend dependencies:

```bash
npm install
```

Start the FastAPI service from `../ai-service`:

```bash
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8011 --reload
```

Enable the NestJS integration in `backend/.env`:

```env
AI_SERVICE_ENABLED=true
AI_SERVICE_URL=http://127.0.0.1:8011
AI_SERVICE_TIMEOUT_MS=12000
```

Start the backend:

```bash
npm run start:dev
```

### Environment Variables

- `AI_SERVICE_ENABLED`: defaults to `false`. When false, backend anomaly calls fail closed with service unavailable.
- `AI_SERVICE_URL`: required when `AI_SERVICE_ENABLED=true`.
- `AI_SERVICE_TIMEOUT_MS`: FastAPI response timeout in milliseconds, default `12000`.

The backend request body limit remains `1mb`; anomaly requests are additionally limited to `512` IMS feature rows.

### Endpoints

- `GET /ai-anomaly/models`: model metadata and limitations, admin/technician only.
- `POST /ai-anomaly/analyses`: stateful single-timestamp analysis, authenticated roles.
- `POST /ai-anomaly/analyses/batch`: stateless deterministic replay, authenticated roles.
- `GET /ai-anomaly/analyses`: paginated history, admin/technician only.
- `GET /ai-anomaly/analyses/:id`: one audit record, admin/technician only.
- `GET /ai-anomaly/machines/:machineId/history`: machine-scoped history, admin/technician only.
- `PATCH /ai-anomaly/analyses/:id/validation`: confirm or reject an analysis, admin/technician only.

Request example:

```json
{
  "machine_id": "64a111111111111111111111",
  "capteur_id": "64a222222222222222222222",
  "input_source": "DATASET_REPLAY",
  "rows": [
    {
      "timestamp": "2003-11-15T18:18:46",
      "experiment": "1st_test",
      "sensor_channel": 1,
      "bearing": 1,
      "axis": "x",
      "rms": 0.1246,
      "standard_deviation": 0.0811,
      "peak_to_peak": 1.108,
      "kurtosis": 4.0697,
      "skewness": -0.03,
      "crest_factor": 5.7778,
      "spectral_energy": 67.3877,
      "dominant_frequency_hz": 986.328125
    }
  ]
}
```

Response records include `analysis_id`, machine/capteur references, requester, model version, experiment, timestamp, bearing, anomaly/risk fields, component scores, reason codes, `prototype_result`, validation status, and timestamps. The full raw vibration payload is not stored.

Validation example:

```json
{
  "validation_status": "CONFIRMED",
  "validation_comment": "Technician confirmed matching vibration symptoms."
}
```

### Scientific Limitations

- The model uses IMS public test-rig data.
- Validation currently covers only `1st_test`.
- Generalization to `2nd_test`, `3rd_test`, and IPROTEX factory machines is not established.
- `prototypeResult=true` is retained for auditability and means the result is a deterministic prototype, not a certified industrial safety threshold.
- Backend machine/capteur IDs are mapped only to the platform audit record. The IMS model identity still comes from `experiment`, `sensor_channel`, `bearing`, and `axis`.

### Validation Results

Added focused mocked tests for the NestJS integration:

```bash
npm test -- ai-anomaly --runInBand
```

Latest focused result: `21` tests passed across client, service, and controller specs.

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
npm install -g mau
mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
