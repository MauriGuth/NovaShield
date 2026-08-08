import type { FamilyMemberStatus } from '@novashield/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * Entidades del Modo Familia.
 *
 * Los tipos de columna son los PORTABLES entre better-sqlite3 (dev/tests) y
 * PostgreSQL (producción): varchar, int, boolean, simple-json y los
 * *DateColumn de TypeORM. Nada específico de un motor — la misma definición
 * tiene que sincronizar idéntica en ambos.
 */

@Entity('families')
export class FamilyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 60 })
  name: string;

  /** Sin confusables (ver InviteCodes); único para poder buscar al unirse. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 16 })
  inviteCode: string;

  @CreateDateColumn()
  createdAt: Date;
}

@Entity('family_members')
@Unique('UQ_family_seat', ['familyId', 'seat'])
export class FamilyMemberEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => FamilyEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'familyId' })
  family: FamilyEntity;

  @Index()
  @Column({ type: 'varchar' })
  familyId: string;

  /**
   * Número de "asiento" dentro de la familia, con índice único junto a
   * `familyId`. Es lo que hace cumplir el tope de integrantes: chequear el
   * conteo y después insertar deja una ventana (TOCTOU) en la que varias
   * uniones simultáneas leen el mismo conteo viejo y entran todas. Con el
   * asiento, dos inserciones que compiten por el mismo número chocan contra la
   * base y una falla — el límite lo garantiza el motor, no el orden de las
   * requests.
   */
  @Column({ type: 'int' })
  seat: number;

  @Column({ type: 'varchar', length: 30 })
  displayName: string;

  @Column({ type: 'varchar', length: 10 })
  role: 'admin' | 'member';

  /**
   * SHA-256 (hex) del token bearer del dispositivo. El token en claro se emite
   * una sola vez y NO se guarda: quien robe la base no puede suplantar a nadie.
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  tokenHash: string;

  /**
   * Estado de protección reportado por el dispositivo. SOLO contadores,
   * booleanos y el score — la regla de privacidad del feature vive en el tipo
   * compartido, y este JSON no debe crecer más allá de él.
   */
  @Column({ type: 'simple-json', nullable: true })
  status: FamilyMemberStatus | null;

  @CreateDateColumn()
  joinedAt: Date;
}
