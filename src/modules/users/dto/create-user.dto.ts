import { IsString, IsEmail, IsEnum, IsOptional, IsMongoId, MinLength, IsArray, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum UserRole {
  SYSTEM_ADMIN = 'SystemAdmin',
  TENANT_ADMIN = 'TenantAdmin',
  USER = 'User',
}

export enum RegistrationStatus {
  PENDING = 'pending',
  INVITED = 'invited',
  REGISTERED = 'registered',
  CANCELLED = 'cancelled',
}

export class CreateUserDto {
  @ApiProperty({ example: '+1234567890', required: false })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'John' })
  @IsString()
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  lastName: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @IsMongoId()
  entityId: string;

  @ApiProperty({ example: 'tenant-123' })
  @IsString()
  tenantId: string;

  @ApiProperty({ enum: UserRole, example: UserRole.USER, required: false })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

export class UpdateUserDto {
  @ApiProperty({ example: '+1234567890', required: false })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiProperty({ example: 'user@example.com', required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ example: 'John', required: false })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiProperty({ example: 'Doe', required: false })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiProperty({ example: 'password123', required: false })
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011', required: false })
  @IsOptional()
  @IsMongoId()
  entityId?: string;

  @ApiProperty({ enum: UserRole, example: UserRole.USER, required: false })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

export class InviteUserDto {
  @ApiProperty({ example: '+1234567890', required: false })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'John' })
  @IsString()
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  lastName: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @IsMongoId()
  entityId: string;

  @ApiProperty({ example: 'tenant-123', required: false })
  @IsString()
  tenantId: string;

  @ApiProperty({ enum: UserRole, example: UserRole.USER, required: false })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

export class BulkInviteUserDto {
  @ApiProperty({ type: [InviteUserDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InviteUserDto)
  users: Omit<InviteUserDto, 'tenantId'>[];

  @ApiProperty({ example: 'tenant-123' })
  @IsString()
  tenantId: string;
}

export class UpdateRegistrationStatusDto {
  @ApiProperty({ enum: RegistrationStatus, example: RegistrationStatus.REGISTERED })
  @IsEnum(RegistrationStatus)
  status: RegistrationStatus;
}
