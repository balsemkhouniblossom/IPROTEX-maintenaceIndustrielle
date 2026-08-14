import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'node:crypto';
import { SavedView, SavedViewDocument } from '../schemas/saved-view.schema';
import { CreateSavedViewDto } from './dto/create-saved-view.dto';
import { UpdateSavedViewDto } from './dto/update-saved-view.dto';

export type SavedViewActor = { userId: string };

/**
 * Every read/write here is scoped to the calling user's own `user_id` —
 * saved views are a personal convenience layer over a list page's
 * search/filter/sort state, never shared or cross-visible, so there is no
 * "Admin sees everyone's views" escape hatch the way there is for reports.
 */
@Injectable()
export class SavedViewsService {
  constructor(
    @InjectModel(SavedView.name)
    private readonly savedViewModel: Model<SavedViewDocument>,
  ) {}

  async create(
    dto: CreateSavedViewDto,
    actor: SavedViewActor,
  ): Promise<SavedViewDocument> {
    return this.savedViewModel.create({
      view_id: `VIEW-${crypto.randomUUID()}`,
      user_id: new Types.ObjectId(actor.userId),
      page_key: dto.pageKey,
      name: dto.name,
      query: dto.query,
      is_default: dto.isDefault ?? false,
    });
  }

  async listForPage(
    pageKey: string,
    actor: SavedViewActor,
  ): Promise<SavedViewDocument[]> {
    return this.savedViewModel
      .find({ user_id: new Types.ObjectId(actor.userId), page_key: pageKey })
      .sort({ createdAt: -1 })
      .exec();
  }

  async update(
    id: string,
    dto: UpdateSavedViewDto,
    actor: SavedViewActor,
  ): Promise<SavedViewDocument> {
    const view = await this.getOwned(id, actor);
    if (dto.name !== undefined) view.name = dto.name;
    if (dto.query !== undefined) view.query = dto.query;
    if (dto.isDefault !== undefined) view.is_default = dto.isDefault;
    await view.save();
    return view;
  }

  async remove(id: string, actor: SavedViewActor): Promise<void> {
    const view = await this.getOwned(id, actor);
    await this.savedViewModel.findByIdAndDelete(view._id).exec();
  }

  private async getOwned(
    id: string,
    actor: SavedViewActor,
  ): Promise<SavedViewDocument> {
    const view = await this.savedViewModel.findById(id).exec();
    if (!view) throw new NotFoundException('Saved view not found');
    if (view.user_id.toString() !== actor.userId) {
      throw new ForbiddenException('You may only manage your own saved views');
    }
    return view;
  }
}
