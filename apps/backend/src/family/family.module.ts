import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FamilyAuthGuard } from './family-auth.guard';
import { FamilyController } from './family.controller';
import { FamilyEntity, FamilyMemberEntity } from './family.entities';
import { FamilyService } from './family.service';

@Module({
  imports: [TypeOrmModule.forFeature([FamilyEntity, FamilyMemberEntity])],
  controllers: [FamilyController],
  providers: [FamilyService, FamilyAuthGuard],
})
export class FamilyModule {}
