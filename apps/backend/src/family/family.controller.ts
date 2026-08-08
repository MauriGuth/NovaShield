import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type {
  FamilyAuthResponse,
  FamilyMemberStatus,
  FamilyOverview,
} from '@novashield/shared';
import { CurrentMember, FamilyAuthGuard } from './family-auth.guard';
import { FamilyMemberEntity } from './family.entities';
import { FamilyService } from './family.service';
import { CreateFamilyDto, JoinFamilyDto, ReportStatusDto } from './dto/family.dtos';

@Controller('family')
export class FamilyController {
  constructor(private readonly family: FamilyService) {}

  /**
   * Crear y unirse llevan un límite MUCHO más chico que el global: son los
   * únicos endpoints sin token, y el de unión es el blanco natural de fuerza
   * bruta contra códigos de invitación.
   */
  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  create(@Body() body: CreateFamilyDto): Promise<FamilyAuthResponse> {
    return this.family.create(body);
  }

  @Post('join')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  join(@Body() body: JoinFamilyDto): Promise<FamilyAuthResponse> {
    return this.family.join(body);
  }

  @Get('me')
  @UseGuards(FamilyAuthGuard)
  overview(@CurrentMember() member: FamilyMemberEntity): Promise<FamilyOverview> {
    return this.family.overview(member);
  }

  @Put('me/status')
  @UseGuards(FamilyAuthGuard)
  reportStatus(
    @CurrentMember() member: FamilyMemberEntity,
    @Body() body: ReportStatusDto,
  ): Promise<FamilyMemberStatus> {
    return this.family.reportStatus(member, body);
  }

  @Post('leave')
  @HttpCode(204)
  @UseGuards(FamilyAuthGuard)
  async leave(@CurrentMember() member: FamilyMemberEntity): Promise<void> {
    await this.family.leave(member);
  }

  /** Cambia el código cuando se filtró. Solo admin. */
  @Post('invite/rotate')
  @HttpCode(200)
  @UseGuards(FamilyAuthGuard)
  rotateInvite(@CurrentMember() member: FamilyMemberEntity): Promise<FamilyOverview> {
    return this.family.rotateInviteCode(member);
  }

  /** Saca a un integrante. Solo admin, y nunca a sí mismo. */
  @Delete('members/:id')
  @UseGuards(FamilyAuthGuard)
  removeMember(
    @CurrentMember() member: FamilyMemberEntity,
    @Param('id') id: string,
  ): Promise<FamilyOverview> {
    return this.family.removeMember(member, id);
  }
}
