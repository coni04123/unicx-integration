import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Entity } from '../../common/schemas/entity.schema';
import { User, UserRole } from '../../common/schemas/user.schema';
import { CreateEntityDto } from './dto/create-entity.dto';
import { UpdateEntityDto } from './dto/update-entity.dto';
import { MoveEntityDto } from './dto/move-entity.dto';
import { SYSTEM_ENTITY_ID, isSystemEntity } from '../../common/constants/system-entity';

@Injectable()
export class EntitiesService {
  constructor(
    @InjectModel(Entity.name)
    private entityModel: Model<Entity>,
    @InjectModel(User.name)
    private userModel: Model<User>,
  ) {}

  async create(createEntityDto: CreateEntityDto, userId: string, userRole: string, userEntityId: string): Promise<Entity> {
    const { name, type, parentId, metadata } = createEntityDto;


    // Validate parent exists if provided
    let parent: Entity | null = null;
    if (parentId) {
      parent = await this.entityModel.findOne({
        _id: new Types.ObjectId(parentId),
        isActive: true,
      });

      if (!parent) {
        throw new NotFoundException('Parent entity not found');
      }

      // Prevent circular references
      if (await this.wouldCreateCircularReference(parentId)) {
        throw new BadRequestException('Cannot create circular reference');
      }
    }

    // Authorization check for TenantAdmin
    if (userRole === UserRole.TENANT_ADMIN) {
      // TenantAdmin can only create entities under their hierarchy
      if (parentId) {
        const canManage = await this.canManageEntity(userEntityId, parentId);
        if (!canManage) {
          throw new ForbiddenException('You can only create entities under your entity hierarchy');
        }
      } else {
        // TenantAdmin cannot create root entities
        throw new ForbiddenException('Tenant admins cannot create root entities');
      }
    }

    // Generate path
    const path = await this.generatePath(name, parentId);


    // Calculate level
    const level = parentId ? await this.calculateLevel(parentId) + 1 : 0;

    const newObjectId = new Types.ObjectId();

    const entityIdPath = await this.generateEntityPath(newObjectId, parentId ? new Types.ObjectId(parentId) : null);

    const entity = new this.entityModel({
      _id: newObjectId,
      name,
      type,
      parentId: new Types.ObjectId(parentId) || null,
      path,
      entityIdPath,
      tenantId: parentId ? new Types.ObjectId(parent.tenantId) : newObjectId,
      level,
      metadata: metadata || {},
      createdBy: userId,
    });

    return entity.save();
  }

  async findAll(tenantId: string, filters?: any): Promise<Entity[]> {
    let query: any;
    
    if (tenantId)
    query = { tenantId: new Types.ObjectId(tenantId), isActive: true };
    else query = { isActive: true };

    if (filters?.type) {
      query.type = filters.type;
    }

    if (filters?.parentId) {
      query.parentId = filters.parentId;
    }

    if (filters?.level !== undefined) {
      query.level = filters.level;
    }

    if (filters?.search) {
      query.name = { $regex: filters.search, $options: 'i' };
    }

    if (filters?.ancestorId && filters?.ancestorId !== SYSTEM_ENTITY_ID.toString()) {
      query.entityIdPath = new Types.ObjectId(filters.ancestorId); 
    }

    return this.entityModel.find(query).sort({ path: 1 });
  }

  async findOne(id: string, tenantId: string): Promise<Entity> {

    const entity = await this.entityModel.findOne({
      _id: new Types.ObjectId(id),
      isActive: true,
    });

    if (!entity) {
      throw new NotFoundException('Entity not found');
    }

    return entity;
  }

  async findHierarchy(tenantId: string, maxDepth?: number): Promise<Entity[]> {
    const query: any = { isActive: true };
    
    // Only filter by tenantId if provided (SystemAdmin has no tenantId)
    if (tenantId && tenantId !== '') {
      query.tenantId = new Types.ObjectId(tenantId);
    }

    if (maxDepth !== undefined) {
      query.level = { $lte: maxDepth };
    }

    return this.entityModel.find(query).sort({ path: 1 });
  }

  async update(id: string, updateEntityDto: UpdateEntityDto, userId: string, tenantId: string, userRole: string, userEntityId: string): Promise<Entity> {
    const entity = await this.findOne(id, '');

    // Authorization check for TenantAdmin
    if (userRole === UserRole.TENANT_ADMIN) {
      const canManage = await this.canManageEntity(userEntityId, id);
      if (!canManage) {
        throw new ForbiddenException('You can only edit entities under your entity hierarchy');
      }
    }

    const updateData: any = {
      updatedBy: userId,
    };

    // Update name
    if (updateEntityDto.name && updateEntityDto.name !== entity.name) {
      updateData.name = updateEntityDto.name;
      // updateData.path = await this.generatePath(updateEntityDto.name, entity.parentId?.toString());
      
      // Update descendants' paths when name changes
      // await this.updateDescendantsPaths(id, tenantId);
    }

    // Update type
    if (updateEntityDto.type && updateEntityDto.type !== entity.type) {
      updateData.type = updateEntityDto.type;
    }

    // Update metadata
    if (updateEntityDto.metadata) {
      updateData.metadata = updateEntityDto.metadata;
    }

    // Update isExpanded
    if (updateEntityDto.isExpanded !== undefined) {
      updateData.isExpanded = updateEntityDto.isExpanded;
    }

    return this.entityModel.findByIdAndUpdate(new Types.ObjectId(id), updateData, { new: true });
  }

  async move(id: string, moveEntityDto: MoveEntityDto, userId: string, tenantId: string, userRole: string, userEntityId: string): Promise<Entity> {
    const entity = await this.findOne(id, tenantId);
    const { newParentId } = moveEntityDto;

    // Authorization check for TenantAdmin
    if (userRole === UserRole.TENANT_ADMIN) {
      // Check if user can manage the entity being moved
      const canManageEntity = await this.canUserManageEntity(userEntityId, id);
      if (!canManageEntity) {
        throw new ForbiddenException('You can only move entities under your entity hierarchy');
      }

      // Check if user can manage the new parent (if provided)
      if (newParentId) {
        const canManageParent = await this.canUserManageEntity(userEntityId, newParentId);
        if (!canManageParent) {
          throw new ForbiddenException('You can only move entities to parents under your entity hierarchy');
        }
      } else {
        // TenantAdmin cannot move entities to root level
        throw new ForbiddenException('Tenant admins cannot move entities to root level');
      }
    }

    // Validate new parent exists if provided
    if (newParentId) {
      const newParentQuery: any = {
        _id: newParentId,
        isActive: true,
      };
      
      // Only filter by tenantId if provided (SystemAdmin has no tenantId)
      if (tenantId && tenantId !== '') {
        newParentQuery.tenantId = new Types.ObjectId(tenantId);
      }
      
      const newParent = await this.entityModel.findOne(newParentQuery);

      if (!newParent) {
        throw new NotFoundException('New parent entity not found');
      }

      // Prevent circular references
      if (await this.wouldCreateCircularReference(newParentId, id)) {
        throw new BadRequestException('Cannot create circular reference');
      }
    }

    // Update entity
    const newPath = await this.generatePath(entity.name, newParentId);
    const newLevel = newParentId ? await this.calculateLevel(newParentId) + 1 : 0;

    await this.entityModel.findByIdAndUpdate(id, {
      parentId: newParentId || null,
      path: newPath,
      level: newLevel,
      updatedBy: userId,
    });

    // Update all descendants' paths and levels
    await this.updateDescendantsPaths(id, tenantId);

    return this.findOne(id, tenantId);
  }

  async remove(id: string, userId: string, tenantId: string, userRole: string, userEntityId: string): Promise<void> {
    await this.findOne(id, '');

    // Authorization check for TenantAdmin
    if (userRole === UserRole.TENANT_ADMIN) {
      const canManage = await this.canManageEntity(userEntityId, id);
      if (!canManage) {
        throw new ForbiddenException('You can only delete entities under your entity hierarchy');
      }
    }

    const children = await this.entityModel.find({
      parentId: new Types.ObjectId(id),
      isActive: true,
    });

    console.log('children', id);

    // Check if entity has children
    const childrenCount = await this.entityModel.countDocuments({
      parentId: new Types.ObjectId(id),
      isActive: true,
    });

    if (childrenCount > 0) {
      throw new BadRequestException('Cannot delete entity with children');
    }

    // Check if entity has users
    const usersCount = await this.userModel.countDocuments({
      entityId: new Types.ObjectId(id),
      isActive: true,
    });

    if (usersCount > 0) {
      throw new BadRequestException('Cannot delete entity with active users');
    }

    // Soft delete
    await this.entityModel.findByIdAndUpdate(new Types.ObjectId(id), {
      isActive: false,
      updatedBy: userId,
    });
  }

  async getEntityStats(tenantId: string): Promise<any> {
    // Build match query - only include tenantId if provided (SystemAdmin has no tenantId)
    const matchQuery: any = { isActive: true };
    if (tenantId && tenantId !== '') {
      matchQuery.tenantId = new Types.ObjectId(tenantId);
    }

    const stats = await this.entityModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          avgLevel: { $avg: '$level' },
        },
      },
    ]);

    const totalEntities = await this.entityModel.countDocuments(matchQuery);
    const totalUsers = await this.userModel.countDocuments(matchQuery);

    return {
      totalEntities,
      totalUsers,
      byType: stats,
    };
  }

  /**
   * Check if an entity is the System entity
   * @param entityId - The entity ID to check
   * @returns true if the entity is the System entity
   */
  isSystemEntity(entityId: Types.ObjectId | string): boolean {
    return isSystemEntity(entityId);
  }

  /**
   * Get the System entity ID constant
   * @returns The System entity ObjectId
   */
  getSystemEntityId(): Types.ObjectId {
    return SYSTEM_ENTITY_ID;
  }

  private async generatePath(name: string, parentId: string | null): Promise<string> {
    if (!parentId) {
      return name;
    }

    const parent = await this.entityModel.findOne({
      _id: new Types.ObjectId(parentId),
      isActive: true,
    });

    if (!parent) {
      throw new NotFoundException('Parent entity not found');
    }

    return `${parent.path} > ${name}`;
  }

  private async generateEntityPath(entityId: Types.ObjectId, parentId: Types.ObjectId | null): Promise<Types.ObjectId[]> {
    if (!parentId) {
      return [entityId];
    }

    const parent = await this.entityModel.findOne({
      _id: parentId,
      isActive: true,
    });

    if (!parent) {
      throw new NotFoundException('Parent entity not found');
    }

    const path = parent.entityIdPath;
    path.push(entityId);
    
    return path; 
  }

  private async calculateLevel(parentId: string): Promise<number> {
    const parent = await this.entityModel.findOne({
      _id: new Types.ObjectId(parentId),
      isActive: true,
    });

    return parent ? parent.level : 0;
  }

  private async wouldCreateCircularReference(parentId: string, excludeId?: string): Promise<boolean> {
    const query: any = { _id: parentId, isActive: true };
    if (excludeId) {
      query._id = { $ne: excludeId };
    }

    const parent = await this.entityModel.findOne(query);
    if (!parent) {
      return false;
    }

    // Check if the parent is a descendant of the entity being moved
    if (excludeId) {
      const descendants = await this.getAllDescendants(excludeId);
      return descendants.some(desc => desc._id.toString() === parentId);
    }

    return false;
  }

  private async getAllDescendants(entityId: string): Promise<Entity[]> {
    const descendants: Entity[] = [];
    const children = await this.entityModel.find({
      parentId: entityId,
      isActive: true,
    });

    for (const child of children) {
      descendants.push(child);
      const childDescendants = await this.getAllDescendants(child._id.toString());
      descendants.push(...childDescendants);
    }

    return descendants;
  }

  private async updateDescendantsPaths(entityId: string, tenantId: string): Promise<void> {
    const descendants = await this.getAllDescendants(entityId);
    const entity = await this.entityModel.findById(entityId);

    for (const descendant of descendants) {
      const newPath = await this.generatePath(descendant.name, descendant.parentId?.toString());
      const newLevel = await this.calculateLevel(descendant.parentId?.toString()) + 1;

      await this.entityModel.findByIdAndUpdate(descendant._id, {
        path: newPath,
        level: newLevel,
      });
    }
  }

  /**
   * Check if a user can manage an entity based on their role and entity hierarchy
   * TenantAdmin can only manage entities that are under their entity or are their entity itself
   * SystemAdmin can manage all entities
   */
  private async canUserManageEntity(userEntityId: string, targetEntityId: string): Promise<boolean> {
    // If user's entity is the target entity, they can manage it
    if (userEntityId === targetEntityId) {
      return true;
    }

    // Check if target entity is a descendant of user's entity
    const targetEntity = await this.entityModel.findOne({
      _id: targetEntityId,
      isActive: true,
    });

    if (!targetEntity) {
      return false;
    }

    // Check if user's entityId is in the target entity's entityIdPath
    // This means the target entity is under the user's entity hierarchy
    if (targetEntity.entityIdPath && targetEntity.entityIdPath.length > 0) {
      return targetEntity.entityIdPath.some(id => id.toString() === userEntityId);
    }

    // Check parent chain if entityIdPath is not available
    let currentEntity = targetEntity;
    while (currentEntity.parentId) {
      if (currentEntity.parentId.toString() === userEntityId) {
        return true;
      }
      currentEntity = await this.entityModel.findOne({
        _id: currentEntity.parentId,
        isActive: true,
      });
      if (!currentEntity) {
        break;
      }
    }

    return false;
  }

  private async canManageEntity(userEntityId: string, targetEntityId: string): Promise<boolean> {
    // If user's entity is the target entity, they can manage it
    if (userEntityId === targetEntityId) {
      return true;
    }

    // Check if target entity is a descendant of user's entity
    const targetEntity = await this.entityModel.findOne({
      _id: new Types.ObjectId(targetEntityId),
      entityIdPath: new Types.ObjectId(userEntityId),
      isActive: true,
    });

    console.log('targetEntity', targetEntity)

    if (!targetEntity) {
      return false;
    }

    return true;
  }
}
