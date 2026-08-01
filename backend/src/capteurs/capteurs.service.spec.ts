import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { CapteursService } from './capteurs.service';
import { Capteur } from '../schemas/capteur.schema';
import { Mesure } from '../schemas/mesure.schema';

describe('CapteursService', () => {
  let service: CapteursService;
  const capteurModel = {
    find: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
  };
  const mesureModel = {
    exists: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CapteursService,
        {
          provide: getModelToken(Capteur.name),
          useValue: capteurModel,
        },
        {
          provide: getModelToken(Mesure.name),
          useValue: mesureModel,
        },
      ],
    }).compile();

    service = module.get<CapteursService>(CapteursService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns 409 when deleting a sensor with measurements', async () => {
    mesureModel.exists.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ _id: 'measurement-id' }),
    });

    await expect(service.delete('sensor-id')).rejects.toMatchObject({
      status: 409,
    });
    expect(capteurModel.findByIdAndDelete).not.toHaveBeenCalled();
  });
});
